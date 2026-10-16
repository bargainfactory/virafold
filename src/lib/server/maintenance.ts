/**
 * Nightly storage retention: keeps the small VPS disk from filling as usage
 * grows. Policies:
 *  - Rendered videos: 30 days, then the file goes and the clip row reverts to
 *    a re-renderable state (clips → suggested, script videos → failed with an
 *    "expired" note so their Retry button re-queues).
 *  - Generated images: 30 days, file and row.
 *  - Source uploads: 90 days, then the file goes and the project drops out of
 *    Clip Studio (its assets and transcript survive).
 *  - Orphans: files nothing references (deleted projects, crashed render
 *    temp dirs) go after a 2-day safety margin.
 */

import fs from "node:fs";
import path from "node:path";
import {
  clearClipOutput,
  clearProjectStorage,
  listAllStoragePaths,
  listRenderedClips,
  purgeOldGenImages,
} from "./db";

const RENDERS_DIR = path.join(process.cwd(), "data", "renders");
const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

const DAY = 24 * 60 * 60 * 1000;
const RENDER_TTL = 30 * DAY;
const UPLOAD_TTL = 90 * DAY;
const ORPHAN_TTL = 2 * DAY;

function ageOf(abs: string): number | null {
  try {
    return Date.now() - fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
}

function rm(abs: string): void {
  fs.rmSync(abs, { recursive: true, force: true });
}

export function runRetentionSweep(): { removed: number } {
  let removed = 0;

  // 1. Expired renders — row survives, file goes, status reverts.
  const rendered = listRenderedClips();
  for (const clip of rendered) {
    const abs = path.join(process.cwd(), clip.outputPath);
    const age = ageOf(abs);
    if (age === null) {
      // File already missing — normalize the row so the UI offers re-render.
      clearClipOutput(clip.userEmail, clip.id, clip.kind === "script" ? "failed" : "suggested");
      continue;
    }
    if (age > RENDER_TTL) {
      rm(abs);
      clearClipOutput(clip.userEmail, clip.id, clip.kind === "script" ? "failed" : "suggested");
      removed++;
    }
  }

  // 2. Old generated images (thumbnails/covers).
  const cutoff = new Date(Date.now() - RENDER_TTL).toISOString();
  for (const rel of purgeOldGenImages(cutoff)) {
    rm(path.join(process.cwd(), rel));
    removed++;
  }

  // 3. Orphan sweep in renders/: anything no clip or image row points at.
  const known = new Set(
    listRenderedClips().map((c) => path.resolve(process.cwd(), c.outputPath))
  );
  if (fs.existsSync(RENDERS_DIR)) {
    for (const name of fs.readdirSync(RENDERS_DIR)) {
      const abs = path.join(RENDERS_DIR, name);
      const age = ageOf(abs);
      if (age === null) continue;
      // Crashed render temp dirs are orphans after a day.
      if (name.startsWith("tmp-") && age > DAY) {
        rm(abs);
        removed++;
        continue;
      }
      // gen_images rows were just purged; surviving imgs are still referenced.
      if (name.startsWith("img-")) continue;
      // AI-motion dirs have their own TTLs below — deleting vidcache as an
      // orphan would silently re-bill every animated re-render. Edit plans
      // and default thumbnails follow the render TTL, not the orphan TTL.
      if (name === "vidcache" || name === "frames") continue;
      if (name.startsWith("plan-") || name.endsWith("-thumb.jpg")) {
        if (age > RENDER_TTL) {
          rm(abs);
          removed++;
        }
        continue;
      }
      if (!known.has(path.resolve(abs)) && age > ORPHAN_TTL) {
        rm(abs);
        removed++;
      }
    }
  }

  // 3b. AI-motion housekeeping: published frames are one-time (leftovers mean
  // a crashed generation — sweep after an hour); the generation cache follows
  // the render TTL since re-creating it costs real per-second billing.
  for (const [dir, ttl] of [
    [path.join(RENDERS_DIR, "frames"), 60 * 60 * 1000],
    [path.join(RENDERS_DIR, "vidcache"), RENDER_TTL],
  ] as const) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const age = ageOf(abs);
      if (age !== null && age > ttl) {
        rm(abs);
        removed++;
      }
    }
  }

  // 4. Source uploads: orphans after 2 days, referenced files after 90.
  const stored = listAllStoragePaths();
  const storedByAbs = new Map(
    stored.map((s) => [path.resolve(process.cwd(), s.storagePath), s] as const)
  );
  if (fs.existsSync(UPLOADS_DIR)) {
    for (const dir of fs.readdirSync(UPLOADS_DIR)) {
      const dirAbs = path.join(UPLOADS_DIR, dir);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dirAbs);
      } catch {
        continue;
      }
      for (const name of files) {
        const abs = path.join(dirAbs, name);
        const age = ageOf(abs);
        if (age === null) continue;
        const ref = storedByAbs.get(path.resolve(abs));
        if (!ref && age > ORPHAN_TTL) {
          rm(abs);
          removed++;
        } else if (ref && age > UPLOAD_TTL) {
          rm(abs);
          clearProjectStorage(ref.email, ref.id);
          removed++;
        }
      }
    }
  }

  return { removed };
}

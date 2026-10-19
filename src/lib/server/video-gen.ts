/**
 * AI motion: animate a generated still into a short video clip via xAI's
 * Imagine Video API (images-to-video). Used by the script-video renderer to
 * turn static AI imagery beats into moving shots.
 *
 * Billing reality drives the design: generation is priced per second, so
 * every call is (a) gated by a per-plan monthly seconds allowance, (b) cached
 * by content hash so re-renders never re-bill, and (c) strictly additive —
 * any failure falls back to the existing zoompan still, never a blank beat.
 *
 * API (recon-verified 2026-10-13): POST https://api.x.ai/v1/videos/generations
 * {model, prompt, image:{url}, duration} → {request_id}; poll
 * GET /v1/videos/{id} until status done|failed|expired; download video.url.
 * The input image must be a PUBLIC url — stills are published at a one-time
 * token path under /api/frames/ for the duration of the generation.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveField } from "./integrations";
import { publicOriginStatic } from "./base-url";
import { animSecondsThisMonth, insertEvent } from "./db";

export const ANIM_MODELS = {
  lite: "grok-imagine-video-1.5-lite", // $0.02/s
  premium: "grok-imagine-video-1.5", // $0.08/s
} as const;

/** Monthly AI-motion seconds by plan. Free stays 0 — per-second billing. */
export const ANIM_MONTHLY_SECONDS: Record<string, number> = {
  Free: 0,
  Lite: 60,
  Starter: 150,
  "Creator Pro": 360,
  Agency: 900,
};

export function animAllowance(plan: string, email: string): number {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(email.toLowerCase())) return Number.POSITIVE_INFINITY;
  return ANIM_MONTHLY_SECONDS[plan] ?? 0;
}

export function animSecondsLeft(plan: string, email: string): number {
  const cap = animAllowance(plan, email);
  if (!Number.isFinite(cap)) return Number.POSITIVE_INFINITY;
  return Math.max(0, cap - animSecondsThisMonth(email));
}

export const FRAMES_DIR = path.join(process.cwd(), "data", "renders", "frames");
const CACHE_DIR = path.join(process.cwd(), "data", "renders", "vidcache");
const POLL_MS = 5000;
const DEADLINE_MS = 4 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Animate one still. Returns the cached mp4 path and the seconds that were
 * actually billed (0 on a cache hit), or null on any failure — callers keep
 * the still. `email` is only used for the usage-telemetry event.
 */
export async function animateStill(opts: {
  email: string;
  pngPath: string;
  motion: string;
  durationSec: number;
  model: string;
  /** Character portraits for pixel-level continuity — reference_images on
   *  video-1.5 (verified live): the model matches the faces to these instead
   *  of re-imagining them from the prompt. */
  refPaths?: string[];
}): Promise<{ file: string; billedSeconds: number } | null> {
  const key = resolveField("llm", "xaiApiKey");
  if (!key) return null;
  const dur = Math.min(15, Math.max(1, Math.ceil(opts.durationSec)));

  let png: Buffer;
  try {
    png = fs.readFileSync(opts.pngPath);
  } catch {
    return null;
  }
  const refs: Buffer[] = [];
  for (const p of (opts.refPaths ?? []).slice(0, 6)) {
    try {
      refs.push(fs.readFileSync(p));
    } catch {
      /* missing portrait — continue without it */
    }
  }

  // Content-addressed cache: same still + same motion + same model + same
  // duration + same references = same clip; regens re-bill nothing.
  const h = crypto
    .createHash("sha256")
    .update(png)
    .update(opts.motion)
    .update(opts.model)
    .update(String(dur));
  for (const r of refs) h.update(r);
  const hash = h.digest("hex").slice(0, 16);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachedPath = path.join(CACHE_DIR, `${hash}.mp4`);
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 10_000) {
    return { file: cachedPath, billedSeconds: 0 };
  }

  // Publish the frame (and any reference portraits) at one-time token URLs.
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const token = crypto.randomBytes(16).toString("hex");
  const framePath = path.join(FRAMES_DIR, `${token}.png`);
  fs.writeFileSync(framePath, png);
  const refTokens: string[] = [];
  for (const r of refs) {
    const t = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(FRAMES_DIR, `${t}.png`), r);
    refTokens.push(t);
  }
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  try {
    const start = await fetch("https://api.x.ai/v1/videos/generations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.motion,
        image: { url: `${publicOriginStatic()}/api/frames/${token}` },
        ...(refTokens.length
          ? { reference_images: refTokens.map((t) => ({ url: `${publicOriginStatic()}/api/frames/${t}` })) }
          : {}),
        duration: dur,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!start.ok) return null;
    const started = (await start.json()) as Record<string, unknown>;
    const requestId = String(started.request_id ?? started.id ?? "");
    if (!requestId) return null;

    const deadline = Date.now() + DEADLINE_MS;
    let videoUrl: string | null = null;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      try {
        const p = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        });
        if (!p.ok) continue;
        const j = (await p.json()) as {
          status?: string;
          video?: { url?: string };
          url?: string;
        };
        if (j.status === "done") {
          videoUrl = j.video?.url ?? j.url ?? null;
          break;
        }
        if (j.status === "failed" || j.status === "expired") return null;
      } catch {
        /* transient poll error — keep polling until the deadline */
      }
    }
    if (!videoUrl) return null;

    const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!dl.ok) return null;
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.length < 10_000) return null;
    fs.writeFileSync(cachedPath, buf);

    // Usage telemetry → monthly allowance accounting. Billed = requested
    // duration (per-second pricing), recorded only on success.
    insertEvent("anim_seconds", opts.email.toLowerCase(), JSON.stringify({ s: dur, m: opts.model }));
    return { file: cachedPath, billedSeconds: dur };
  } catch {
    return null;
  } finally {
    fs.rmSync(framePath, { force: true });
    for (const t of refTokens) fs.rmSync(path.join(FRAMES_DIR, `${t}.png`), { force: true });
  }
}

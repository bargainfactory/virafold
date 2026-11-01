/**
 * Premium motion via Google's Gemini Omni Flash (gemini-omni-1.1-flash) — the
 * model that replaced the Veo line (Oct 2026). Why it earns the hero beats:
 * stronger physics/coherence, reference-image character consistency (<IMAGE_REF_n>
 * tags bind our 360° turnaround sheets), and ~$0.10/s at 720p.
 *
 * Strictly additive, same contract as the xAI animator: any failure — missing
 * key, moderation block, API drift — returns null and the caller falls through
 * to the xAI chain, which falls back to the zoompan still. A blocked or failed
 * Google call can never cost a beat its motion.
 *
 * API (docs-verified 2026-11-01): POST
 * https://generativelanguage.googleapis.com/v1beta/interactions with
 * {model, input:[{type:"image",data,mime_type},...,{type:"text",text}],
 *  generation_config:{video_config:{task:"image_to_video"}}}; the video comes
 * back in steps[].content[] as inline base64 `data` or a Files-API `uri`.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveField } from "./integrations";
import { insertEvent } from "./db";

const MODEL = "gemini-omni-1.1-flash";
const CACHE_DIR = path.join(process.cwd(), "data", "renders", "vidcache");

export async function omniAnimateStill(opts: {
  email: string;
  pngPath: string;
  motion: string;
  durationSec: number;
  refPaths?: string[];
}): Promise<{ file: string; billedSeconds: number } | null> {
  const key = resolveField("video", "googleApiKey");
  if (!key) return null;
  const dur = Math.min(10, Math.max(3, Math.ceil(opts.durationSec)));

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
      /* missing sheet — continue without it */
    }
  }

  // Content-addressed cache, same rule as the xAI animator: identical inputs
  // never re-bill. Namespaced so a Google clip never collides with an xAI one.
  const h = crypto.createHash("sha256").update(png).update(opts.motion).update(MODEL).update(String(dur));
  for (const r of refs) h.update(r);
  const hash = h.digest("hex").slice(0, 16);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachedPath = path.join(CACHE_DIR, `omni-${hash}.mp4`);
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 10_000) {
    return { file: cachedPath, billedSeconds: 0 };
  }

  let text = `Animate the starting frame <IMAGE_REF_0> into one single continuous ${dur}-second shot. ${opts.motion}`;
  if (refs.length) {
    text += ` The characters' faces, hair, clothing, colors and proportions must exactly match their reference turnaround sheets ${refs
      .map((_, i) => `<IMAGE_REF_${i + 1}>`)
      .join(" ")}.`;
  }
  // Our pipeline owns the voice/music/ambience mix — the clip's own track
  // must never fight it, and on-screen text would survive the splice.
  text += " Quiet natural ambient sound only — no music, no dialogue, no narration, no text on screen.";

  const input: Record<string, unknown>[] = [
    { type: "image", data: png.toString("base64"), mime_type: "image/png" },
    ...refs.map((r) => ({ type: "image", data: r.toString("base64"), mime_type: "image/png" })),
    { type: "text", text },
  ];

  try {
    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input,
        generation_config: { video_config: { task: "image_to_video" } },
        response_format: { type: "video", delivery: "uri" },
        background: false,
        store: false,
        stream: false,
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!resp.ok) {
      // Block, quota, or API drift — log it (the overflag/billing dossier)
      // and let the xAI chain take the beat.
      const errBody = await resp.text().catch(() => "");
      insertEvent(
        "anim_blocked",
        opts.email.toLowerCase(),
        JSON.stringify({ m: "omni", http: resp.status, p: errBody.slice(0, 200) })
      );
      return null;
    }
    const j = (await resp.json()) as {
      steps?: { type?: string; content?: { type?: string; data?: string; uri?: string }[] }[];
    };
    let data: string | null = null;
    let uri: string | null = null;
    for (const s of j.steps ?? []) {
      if (s.type !== "model_output") continue;
      for (const c of s.content ?? []) {
        if (c.type === "video") {
          data = c.data ?? null;
          uri = c.uri ?? null;
        }
      }
    }
    let buf: Buffer | null = null;
    if (data) buf = Buffer.from(data, "base64");
    else if (uri) buf = await downloadOmniFile(uri, key);
    if (!buf || buf.length < 10_000) return null;
    fs.writeFileSync(cachedPath, buf);
    insertEvent("anim_seconds", opts.email.toLowerCase(), JSON.stringify({ s: dur, m: "omni-flash" }));
    return { file: cachedPath, billedSeconds: dur };
  } catch {
    return null;
  }
}

/** Files-API delivery: poll until ACTIVE, then download; if the uri is
 *  already a direct media link, plain GET is the fallback. */
async function downloadOmniFile(uri: string, key: string): Promise<Buffer | null> {
  const headers = { "x-goog-api-key": key };
  const deadline = Date.now() + 120_000;
  try {
    while (Date.now() < deadline) {
      const meta = await fetch(uri, { headers, signal: AbortSignal.timeout(20_000) });
      if (meta.ok) {
        const ct = meta.headers.get("content-type") || "";
        if (ct.includes("video")) return Buffer.from(await meta.arrayBuffer());
        const m = (await meta.json().catch(() => ({}))) as { state?: string };
        if (!m.state || m.state === "ACTIVE") break;
        if (m.state === "FAILED") return null;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    const dl = await fetch(`${uri}:download?alt=media`, { headers, signal: AbortSignal.timeout(120_000) });
    if (dl.ok) return Buffer.from(await dl.arrayBuffer());
    const direct = await fetch(uri, { headers, signal: AbortSignal.timeout(120_000) });
    if (direct.ok) return Buffer.from(await direct.arrayBuffer());
    return null;
  } catch {
    return null;
  }
}

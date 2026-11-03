/**
 * The automated QA gate: every painted beat still is inspected by a vision
 * model against the production contract BEFORE animation and splicing —
 * institutionalizing the manual frame-review loop that caught the drawn
 * cameras, style breaks and stranger-casting bugs. Failed beats get one
 * regeneration with the failure reason folded into the prompt.
 *
 * Checks per frame: hand-painted 2D storybook style held (no photoreal, no
 * 3D render), no text/letters/watermarks, no camera or filming equipment
 * drawn, not an empty/abstract frame, no grotesque anatomy, no duplicated
 * identical character.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveField } from "./integrations";

const QA_SCHEMA_HINT = `Return STRICT JSON: {"results":[{"index":<number>,"verdict":"pass"|"fail","reason":"<short reason, empty when pass>"}]} — one entry per numbered image, in order.`;

function thumb(jobDir: string, file: string, out: string): boolean {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", file, "-vf", "scale=512:-2", "-frames:v", "1", "-q:v", "6", out],
    { cwd: jobDir }
  );
  return r.status === 0 && fs.existsSync(path.join(jobDir, out));
}

export interface QaFlag {
  i: number;
  reason: string;
}

/** Inspect the given beat stills (indices into `images`); returns flags. */
export async function inspectStills(
  jobDir: string,
  entries: { i: number; file: string }[]
): Promise<QaFlag[]> {
  const key = resolveField("llm", "xaiApiKey");
  if (!key || !entries.length) return [];
  const qaDir = path.join(jobDir, "qa");
  fs.mkdirSync(qaDir, { recursive: true });

  const flags: QaFlag[] = [];
  const BATCH = 4;
  for (let at = 0; at < entries.length; at += BATCH) {
    const batch = entries.slice(at, at + BATCH);
    const content: Record<string, unknown>[] = [];
    const sent: number[] = [];
    for (const e of batch) {
      const t = `qa/qa_${e.i}.jpg`;
      if (!thumb(jobDir, e.file, t)) continue;
      const b64 = fs.readFileSync(path.join(jobDir, t)).toString("base64");
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
      sent.push(e.i);
    }
    if (!sent.length) continue;
    content.push({
      type: "text",
      text:
        `These are frames ${sent.join(", ")} (in order) from a hand-painted 2D storybook children's cartoon. ` +
        `Judge EACH frame against the production contract. FAIL a frame only for a clear violation: ` +
        `(a) style break — photorealistic or 3D-render look instead of painted 2D cartoon; ` +
        `(b) visible text, letters, captions or watermarks painted into the image; ` +
        `(c) a camera, lens, film equipment or UI drawn in the picture; ` +
        `(d) empty/abstract frame with no recognizable subject; ` +
        `(e) grotesque anatomy (extra limbs, mangled hands, two heads); ` +
        `(f) the same character appearing twice in one frame. ` +
        `Minor imperfections PASS. ${QA_SCHEMA_HINT}`,
    });
    try {
      const resp = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "grok-4",
          messages: [{ role: "user", content }],
          response_format: { type: "json_object" },
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!resp.ok) continue; // QA is best-effort — a down inspector never blocks a render
      const j = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(text) as { results?: { index?: number; verdict?: string; reason?: string }[] };
      for (const r of parsed.results ?? []) {
        if (r.verdict === "fail" && typeof r.index === "number" && sent.includes(r.index)) {
          flags.push({ i: r.index, reason: String(r.reason ?? "").slice(0, 140) });
        }
      }
    } catch {
      /* best-effort */
    }
  }
  return flags;
}

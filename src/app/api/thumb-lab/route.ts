import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getFlags, getPersona, insertGenImage } from "@/lib/server/db";
import { generateThumbnail, thumbPrompts, visionJson } from "@/lib/server/images";
import { llmComplete, scoreHook } from "@/lib/server/generate";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Thumbnail Lab: CTR-practice variants (expressive face / one big object /
 * cinematic-muted), each carrying a 2-4 word punch overlay distilled from the
 * title (never invented claims), vision-scored on a small-size rubric.
 * `variant` regenerates a single approach — users delete what they reject via
 * DELETE /api/images/[id] and recreate until it clicks. Scores stay labeled
 * heuristics; the published-post A/B (judged on watch behavior, not clicks
 * alone) is the real verdict, which also keeps bait self-defeating.
 */

const RUBRIC = [
  "You are judging a YouTube thumbnail. Score it 0-100 for click-through potential based ONLY on what is visible:",
  "- ONE clear focal subject readable at a glance (clutter is the biggest killer)",
  "- emotional pull: an expressive face, tension, or a striking object",
  "- contrast and color separation that survives shrinking to 120 pixels wide",
  "- text, if present: 1-5 bold words, legible when tiny",
  "- the lower-right corner reasonably clear (YouTube draws the duration badge there)",
  'Return JSON: {"score": <0-100>, "note": "<one sentence on its strongest quality>", "fix": "<one concrete improvement>"}',
].join("\n");

const PUNCH_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

const TITLES_SCHEMA = {
  type: "object",
  properties: { titles: { type: "array", items: { type: "string" } } },
  required: ["titles"],
  additionalProperties: false,
};

/**
 * Title practice, applied as rewrites: under 60 characters (YouTube truncates
 * around there), the hook front-loaded, honest curiosity (the promise must be
 * one the video keeps — bait tanks retention-based distribution), and a
 * complement to the thumbnail rather than a repeat of it. Each rewrite gets
 * the deterministic hook score so the ranking is mechanical, not vibes.
 */
async function titleRewrites(
  title: string
): Promise<{ t: string; score: number; len: number }[]> {
  const res = await llmComplete(
    [
      "Rewrite this video title three ways to maximize click-through WITHOUT bait:",
      "- under 60 characters each, hook word up front",
      "- one curiosity-gap version, one How/Why version, one bold-statement version",
      "- use ONLY facts, numbers, and claims present in the original title; never invent any",
      'Return JSON {"titles": ["...","...","..."]}',
    ].join("\n"),
    title,
    TITLES_SCHEMA as unknown as Record<string, unknown>,
    { tier: "standard", maxTokens: 300, context: "title-lab" }
  );
  const out: { t: string; score: number; len: number }[] = [
    { t: title, score: Math.max(5, Math.round((scoreHook(title) / 9) * 100)), len: title.length },
  ];
  try {
    const titles = (JSON.parse(res?.text ?? "{}") as { titles?: unknown[] }).titles ?? [];
    for (const raw of titles.slice(0, 3)) {
      const t = String(raw).trim().slice(0, 100);
      if (t && t.toLowerCase() !== title.toLowerCase()) {
        out.push({ t, score: Math.max(5, Math.round((scoreHook(t) / 9) * 100)), len: t.length });
      }
    }
  } catch {
    /* original title alone is still a valid result */
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

async function punchText(title: string): Promise<string> {
  const res = await llmComplete(
    "Distill this video title into thumbnail text: 2 to 4 punchy words, ALL CAPS. Use only words and ideas already present in the title — never invent numbers, promises, or claims. Return JSON {\"text\": \"...\"}.",
    title,
    PUNCH_SCHEMA as unknown as Record<string, unknown>,
    { tier: "standard", maxTokens: 60, context: "thumb-punch" }
  );
  try {
    const t = String((JSON.parse(res?.text ?? "{}") as { text?: string }).text ?? "").trim();
    if (t && t.split(/\s+/).length <= 5) return t;
  } catch {
    /* fall through */
  }
  return title.split(/\s+/).slice(0, 3).join(" ");
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  const gate = rateLimit(`thumblab:${user.email}`, 8, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const title = String(b?.title ?? "").trim().slice(0, 120);
  const topic = String(b?.topic ?? title).trim().slice(0, 300);
  if (title.length < 3) {
    return NextResponse.json({ error: "Give the video a title first" }, { status: 400 });
  }
  const personaId = b?.personaId ? String(b.personaId) : "";
  const persona = personaId ? getPersona(user.email, personaId) : null;
  const onlyVariant =
    typeof b?.variant === "number" && b.variant >= 0 && b.variant <= 2 ? b.variant : null;

  // Titles only on a full run — a single-variant redo skips the extra call.
  const [punch, titles] = await Promise.all([
    punchText(title),
    onlyVariant === null ? titleRewrites(title) : Promise.resolve([]),
  ]);
  const prompts = thumbPrompts(topic, persona?.meta ?? null);
  const picks = onlyVariant !== null ? [onlyVariant] : [0, 1, 2];
  const out: { id: string; variant: number; score: number | null; note: string; fix: string }[] = [];
  for (const v of picks) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const result = await generateThumbnail(id, topic, punch, "a", prompts[v]);
    if ("error" in result && result.error) continue;
    insertGenImage(user.email, id, topic, (result as { path: string }).path);
    let score: number | null = null;
    let note = "";
    let fix = "";
    try {
      const png = fs.readFileSync(path.join(process.cwd(), (result as { path: string }).path));
      const verdict = await visionJson([png], RUBRIC);
      if (verdict && typeof verdict.score === "number") {
        score = Math.max(0, Math.min(100, Math.round(verdict.score)));
        note = String(verdict.note ?? "").slice(0, 200);
        fix = String(verdict.fix ?? "").slice(0, 200);
      }
    } catch {
      /* unscored */
    }
    out.push({ id, variant: v, score, note, fix });
  }
  if (out.length === 0) {
    return NextResponse.json(
      { error: "No image provider available — connect an image key in the Operator Console" },
      { status: 503 }
    );
  }
  out.sort((a, b2) => (b2.score ?? -1) - (a.score ?? -1));
  return NextResponse.json({ thumbs: out, punch, titles }, { status: 201 });
}

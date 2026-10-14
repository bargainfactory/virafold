import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getFlags, getPersona, insertGenImage } from "@/lib/server/db";
import { generateThumbnail, thumbPrompts, visionJson } from "@/lib/server/images";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Thumbnail Lab: three CTR-fundamentals variants (emotional face — the
 * persona's face when one is attached — big single object, high-contrast
 * abstract), each vision-scored against a legibility/impact rubric. Scores
 * are presented as heuristics; the thumbnail A/B test on published posts is
 * where real views decide.
 */

const RUBRIC = [
  "You are judging a YouTube thumbnail. Score it 0-100 for click-through potential based ONLY on what is visible:",
  "- one clear subject readable at a glance (not cluttered)",
  "- emotional pull (an expressive face, tension, or a striking object)",
  "- contrast and color pop at small size (imagine it 160 pixels wide)",
  "- text legibility if text is present",
  'Return JSON: {"score": <0-100>, "note": "<one sentence on its strongest quality>", "fix": "<one concrete improvement>"}',
].join("\n");

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  // Three image generations + three vision calls per run.
  const gate = rateLimit(`thumblab:${user.email}`, 4, 60 * 60 * 1000);
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

  const prompts = thumbPrompts(topic, persona?.meta ?? null);
  const out: { id: string; score: number | null; note: string; fix: string }[] = [];
  for (const prompt of prompts) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const result = await generateThumbnail(id, topic, title, "a", prompt);
    if ("error" in result && result.error) continue;
    insertGenImage(user.email, id, topic, (result as { path: string }).path);
    // Score is best-effort; an unscored thumbnail is still usable.
    let score: number | null = null;
    let note = "";
    let fix = "";
    try {
      const png = fs.readFileSync(path.join(process.cwd(), (result as { path: string }).path));
      const v = await visionJson([png], RUBRIC);
      if (v && typeof v.score === "number") {
        score = Math.max(0, Math.min(100, Math.round(v.score)));
        note = String(v.note ?? "").slice(0, 200);
        fix = String(v.fix ?? "").slice(0, 200);
      }
    } catch {
      /* unscored */
    }
    out.push({ id, score, note, fix });
  }
  if (out.length === 0) {
    return NextResponse.json(
      { error: "No image provider available — connect an image key in the Operator Console" },
      { status: 503 }
    );
  }
  out.sort((a, b2) => (b2.score ?? -1) - (a.score ?? -1));
  return NextResponse.json({ thumbs: out }, { status: 201 });
}

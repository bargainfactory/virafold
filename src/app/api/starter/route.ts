import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { getBrandVoice, getFlags, insertIdea, updateIdea } from "@/lib/server/db";
import { generateScript, scoreHook } from "@/lib/server/generate";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Starter pack: a brand-new account types their niche and the first session
 * ends with real material — three scored ideas in their backlog and the top
 * one already scripted — instead of an empty dashboard. Idea titles come from
 * the same proven patterns as the free video-ideas tool; only the one script
 * spends LLM budget.
 */

const PATTERNS = [
  "How I'd start {n} from zero in 2026",
  "5 {n} mistakes beginners always make",
  "The truth about {n} nobody says out loud",
  "Why most {n} creators quit in 90 days",
  "The 80/20 of {n}: what actually matters",
  "What 30 days of daily {n} actually did",
];

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  // One pack per hour — it is a first-run helper, not a generator.
  const gate = rateLimit(`starter:${user.email}`, 2, 60 * 60 * 1000);
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
  const niche = String(b?.niche ?? "").trim().slice(0, 80);
  const locale = b?.locale ? String(b.locale).slice(0, 8) : undefined;
  if (niche.length < 2) {
    return NextResponse.json({ error: "Tell us your niche in a word or two" }, { status: 400 });
  }

  const ranked = PATTERNS.map((p) => {
    const title = p.replace(/\{n\}/g, niche);
    return { title, score: Math.max(5, Math.round((scoreHook(title) / 9) * 100)) };
  })
    .sort((a, b2) => b2.score - a.score)
    .slice(0, 3);

  const ideas = ranked.map((r) =>
    insertIdea(user.email, {
      id: `idea-${crypto.randomUUID()}`,
      title: r.title,
      notes: `Starter pack idea for your niche: ${niche}`,
      script: "",
      score: r.score,
      status: "idea",
    })
  );

  // Script the strongest idea so there is something to turn into a video
  // immediately. Best-effort — the pack is still useful without it.
  let scripted = false;
  try {
    const top = ideas[0];
    const written = await generateScript(top.title, `Niche: ${niche}`, locale, getBrandVoice(user.email));
    if (written.script && written.script.length >= 40) {
      updateIdea(user.email, top.id, { script: written.script, status: "scripted" });
      scripted = true;
    }
  } catch {
    /* script is a bonus, not a requirement */
  }

  return NextResponse.json({ ideas: ideas.length, scripted }, { status: 201 });
}

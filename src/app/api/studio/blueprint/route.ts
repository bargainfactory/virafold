import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { getFlags, getPersona } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/rate-limit";
import { lintScript } from "@/lib/script-lint";

export const dynamic = "force-dynamic";

/**
 * Blueprint: the production desk's free-to-cheap planning stage. Runs ONLY
 * the text passes — the director's checklist, voice casting, story-character
 * designs and recurring props — and returns the whole plan for review BEFORE
 * a single image or second of speech is generated. This stage would have
 * caught "Goliath in 49 scenes" for the cost of two LLM calls.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  const gate = rateLimit(`blueprint:${user.email}`, 20, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  let body: { script?: string; title?: string; props?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const script = String(body.script ?? "").slice(0, 30_000);
  const title = String(body.title ?? "Untitled").slice(0, 200);
  if (script.trim().split(/\s+/).length < 30) {
    return NextResponse.json({ error: "Script too short to blueprint" }, { status: 400 });
  }

  // Free pass: the director's checklist and line map.
  const lint = lintScript(script);

  // Voice casting, exactly as the render will do it.
  const { parseScreenplay, castVoices } = await import("@/lib/server/dialogue");
  const cast = (Array.isArray(body.props) ? body.props : [])
    .slice(0, 4)
    .map((id) => getPersona(user.email, String(id)))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ name: p.name, voice: p.voice, charname: p.charname, meta: p.meta }));
  const parsed = parseScreenplay(script) ?? [];
  const voiceMap = castVoices(parsed, cast);
  const voices: Record<string, string | null> = {};
  for (const [sp, v] of voiceMap.entries()) voices[sp] = v;

  // Cheap LLM passes: story character designs (+aliases) and recurring props —
  // the same calls the render makes, surfaced for approval instead of hidden.
  const { storyCastFor, storyPropsFor } = await import("@/lib/server/scenes");
  const [storyCast, storyProps] = await Promise.all([
    storyCastFor(title, script).catch(() => null),
    storyPropsFor(title, script).catch(() => null),
  ]);

  // Per-line character presence, using the render's own deterministic rule:
  // a design reaches a scene only when the line names the character (name or
  // alias) or they speak it.
  const presence = lint.lines.map((l) => {
    if (l.frame) return [] as string[];
    const lower = ` ${l.text.toLowerCase()} `;
    return (storyCast ?? [])
      .filter(
        (c) =>
          l.speaker.toLowerCase() === c.name.toLowerCase() ||
          lower.includes(c.name.toLowerCase()) ||
          c.aliases.some((a) => a.length > 2 && lower.includes(a.toLowerCase()))
      )
      .map((c) => c.name);
  });

  return NextResponse.json({
    lint,
    voices,
    storyCast: storyCast ?? [],
    storyProps: storyProps ?? [],
    presence,
  });
}

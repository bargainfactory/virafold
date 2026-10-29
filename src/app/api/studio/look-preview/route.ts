import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { getFlags, getPersona } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/rate-limit";
import { lintScript } from "@/lib/script-lint";

export const dynamic = "force-dynamic";

/**
 * Look approval: the ~fifty-cent stage between the free blueprint and the
 * storyboard draft. Generates the film's three strongest poster beats in the
 * real art style with the real cast designs, plus a short voice sampler per
 * speaker — "this is what your film will look and sound like" — so style and
 * casting get approved before the full draft spend.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  const gate = rateLimit(`lookpreview:${user.email}`, 6, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  let body: {
    script?: string;
    title?: string;
    props?: string[];
    wide?: boolean;
    storyCast?: { name: string; design: string; aliases: string[] }[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const script = String(body.script ?? "").slice(0, 30_000);
  const title = String(body.title ?? "Untitled").slice(0, 200);
  if (script.trim().split(/\s+/).length < 30) {
    return NextResponse.json({ error: "Script too short to preview" }, { status: 400 });
  }

  const lint = lintScript(script);
  // The blueprint's cast rides back in so this stage never re-pays for it;
  // without one, compute it fresh.
  const { storyCastFor } = await import("@/lib/server/scenes");
  const storyCast =
    (Array.isArray(body.storyCast) && body.storyCast.length ? body.storyCast : null) ??
    (await storyCastFor(title, script).catch(() => null)) ??
    [];

  // Pick the three strongest story lines: dolly > climax > bloom > reveal,
  // de-duplicated, spread across the script.
  const story = lint.lines.filter((l) => !l.frame);
  const ranked = [
    ...story.filter((l) => l.cues.includes("dolly")),
    ...story.filter((l) => l.climax),
    ...story.filter((l) => l.cues.includes("bloom")),
    ...story.filter((l) => l.cues.includes("reveal")),
    ...story,
  ];
  const picks: typeof story = [];
  for (const l of ranked) {
    if (picks.some((p) => p.i === l.i || Math.abs(p.i - l.i) < 5)) continue;
    picks.push(l);
    if (picks.length >= 3) break;
  }

  const { getVideoStyle } = await import("@/lib/server/scenes");
  const { generateBackground } = await import("@/lib/server/images");
  const styleDef = getVideoStyle("cartoon");
  const posters = await Promise.all(
    picks.map(async (l, n) => {
      const lower = ` ${l.text.toLowerCase()} `;
      const present = storyCast.filter(
        (c) =>
          l.speaker.toLowerCase() === c.name.toLowerCase() ||
          lower.includes(c.name.toLowerCase()) ||
          c.aliases.some((a) => a.length > 2 && lower.includes(a.toLowerCase()))
      );
      const castStr = present.length
        ? present.map((c) => `${c.name} — ${c.design}`).join("; and ")
        : undefined;
      let prompt = styleDef
        ? styleDef.imagePrompt(l.text.slice(0, 140), n * 7, castStr, 0.4)
        : `Storybook illustration of: ${l.text.slice(0, 140)}. No text.`;
      if (body.wide) prompt = prompt.replace(/Vertical 9:16 composition/g, "Widescreen 16:9 cinematic composition");
      const img = await generateBackground(prompt).catch(() => null);
      return img ? { line: l.text.slice(0, 160), b64: img.toString("base64") } : null;
    })
  );

  // Voice sampler: one short line for the narrator and each distinct voice.
  const { parseScreenplay, castVoices } = await import("@/lib/server/dialogue");
  const { synthesizeSpeech } = await import("@/lib/server/tts");
  const { getCustomVoiceId } = await import("@/lib/server/db");
  const cast = (Array.isArray(body.props) ? body.props : [])
    .slice(0, 4)
    .map((id) => getPersona(user.email, String(id)))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ name: p.name, voice: p.voice, charname: p.charname, meta: p.meta }));
  const voiceMap = castVoices(parseScreenplay(script) ?? [], cast);
  const defaultVoice = getCustomVoiceId(user.email);
  const seen = new Set<string>();
  const samples: { speaker: string; b64: string }[] = [];
  for (const [sp, v] of voiceMap.entries()) {
    const vk = v ?? "__narration__";
    if (seen.has(vk) || samples.length >= 6) continue;
    seen.add(vk);
    const line = lint.lines.find((l) => l.speaker === sp && l.text.length > 25 && l.text.length < 160);
    if (!line) continue;
    const tts = await synthesizeSpeech(line.text.slice(0, 140), "en", v ?? defaultVoice).catch(() => null);
    if (tts) samples.push({ speaker: sp, b64: tts.bytes.toString("base64") });
  }

  return NextResponse.json({
    posters: posters.filter(Boolean),
    samples,
    storyCast,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { bestPlanFor, getClip, getFlags, insertScriptVideo } from "@/lib/server/db";
import { kickRenderWorker } from "@/lib/server/render";
import { llmComplete } from "@/lib/server/generate";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * One-click dubbing: a ready script video re-rendered in another language —
 * script translated for the ear, narrated by the multilingual TTS chain (the
 * creator's cloned voice where the provider supports it), captions in the
 * target language. Same visuals recipe; the animation cache even reuses
 * identical beats. Paid plans — every dub is a full TTS + render run.
 */

const LANGS: Record<string, string> = {
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  hi: "Hindi",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  tr: "Turkish",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  th: "Thai",
  vi: "Vietnamese",
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ar: "Arabic",
};

const DUB_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } } },
  required: ["lines"],
  additionalProperties: false,
};

/**
 * Line-by-line screenplay translation. Only the spoken half of each line is
 * translated: speaker labels and voice tags (`NAOMI:`, `VOICE(atlas):`) stay
 * verbatim so casting and voice assignment survive, and `#` production notes
 * stay in English because they are never spoken — they feed the art prompts.
 * Chunked so feature-length scripts never hit a token ceiling.
 */
const SPEAKER_RE = /^([A-Z][A-Z0-9 _'’-]{0,40}(?:\([a-z0-9_-]{1,24}\))?:\s*)(.*)$/;

async function translateScript(script: string, language: string): Promise<string | null> {
  type Seg = { keep: string } | { prefix: string; text: string };
  const segs: Seg[] = script.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return { keep: line };
    const m = trimmed.match(SPEAKER_RE);
    if (m && m[2]) return { prefix: m[1], text: m[2] };
    return { prefix: "", text: trimmed };
  });
  const jobs = segs
    .map((s, i) => ({ s, i }))
    .filter((x): x is { s: { prefix: string; text: string }; i: number } => "text" in x.s);

  const CHUNK = 25;
  const out = new Map<number, string>();
  for (let at = 0; at < jobs.length; at += CHUNK) {
    const batch = jobs.slice(at, at + CHUNK);
    const res = await llmComplete(
      `Translate each line of spoken video dialogue into natural, conversational ${language} — written for the EAR, not the page. Keep every personal name, place name, number, and Bible reference. Never merge, split, add, or drop lines. Return JSON {"lines": [...]} with exactly ${batch.length} strings in the same order.`,
      JSON.stringify(batch.map((b) => b.s.text)),
      DUB_SCHEMA as unknown as Record<string, unknown>,
      { tier: "standard", maxTokens: 4000, context: "dub" }
    );
    if (!res) return null;
    let lines: unknown;
    try {
      lines = (JSON.parse(res.text) as { lines?: unknown }).lines;
    } catch {
      return null;
    }
    if (!Array.isArray(lines) || lines.length !== batch.length) return null;
    batch.forEach((b, j) => out.set(b.i, String(lines[j as number] ?? "").trim()));
  }

  const rebuilt = segs
    .map((s, i) => ("keep" in s ? s.keep : `${s.prefix}${out.get(i) || s.text}`))
    .join("\n");
  return rebuilt.trim().length >= 40 ? rebuilt : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  if (bestPlanFor(user.email) === "Free") {
    return NextResponse.json(
      { error: "Dubbing is included on paid plans — each dub is a full narration and render run." },
      { status: 403 }
    );
  }
  const gate = rateLimit(`dub:${user.email}`, 6, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip || clip.kind !== "script" || clip.status !== "ready" || !clip.script) {
    return NextResponse.json({ error: "Only ready script videos can be dubbed" }, { status: 400 });
  }

  let lang = "";
  try {
    lang = String(((await req.json()) as Record<string, unknown>)?.language ?? "");
  } catch {
    /* fall through to validation */
  }
  if (!LANGS[lang]) return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  if (lang === clip.lang) {
    return NextResponse.json({ error: "The video is already in that language" }, { status: 400 });
  }

  const translated = await translateScript(clip.script, LANGS[lang]);
  if (!translated) {
    return NextResponse.json({ error: "Translation failed — please retry" }, { status: 502 });
  }

  let props: string[] | undefined;
  try {
    props = clip.props ? (JSON.parse(clip.props) as string[]) : undefined;
  } catch {
    props = undefined;
  }
  const dub = insertScriptVideo(user.email, {
    id: `sv-${crypto.randomUUID()}`,
    title: `${clip.title} [${lang.toUpperCase()}]`,
    script: translated,
    style: clip.style,
    position: clip.position,
    animate: clip.animate, // the exact animation level — a dub is the same film
    vstyle: clip.vstyle ?? undefined,
    personaId: clip.personaId ?? undefined,
    props,
    lang,
    orient: clip.orient ?? undefined,
  });
  kickRenderWorker();
  return NextResponse.json({ clip: dub }, { status: 201 });
}

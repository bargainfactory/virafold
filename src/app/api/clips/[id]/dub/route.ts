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
};

const DUB_SCHEMA = {
  type: "object",
  properties: { script: { type: "string" } },
  required: ["script"],
  additionalProperties: false,
};

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

  const res = await llmComplete(
    `Translate this spoken video script into natural, conversational ${LANGS[lang]} — written for the EAR, not the page. Keep every name, number, and claim exactly as given; never add or soften anything. Return JSON {"script": "<translation>"}.`,
    clip.script,
    DUB_SCHEMA as unknown as Record<string, unknown>,
    { tier: "standard", maxTokens: 3000, context: "dub" }
  );
  if (!res) {
    return NextResponse.json({ error: "Translation unavailable — retry shortly" }, { status: 503 });
  }
  let translated = "";
  try {
    translated = String((JSON.parse(res.text) as { script?: string }).script ?? "").trim();
  } catch {
    /* handled below */
  }
  if (translated.length < 40) {
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
    script: translated.slice(0, 4800),
    style: clip.style,
    position: clip.position,
    animate: Boolean(clip.animate),
    vstyle: clip.vstyle ?? undefined,
    personaId: clip.personaId ?? undefined,
    props,
    lang,
  });
  kickRenderWorker();
  return NextResponse.json({ clip: dub }, { status: 201 });
}

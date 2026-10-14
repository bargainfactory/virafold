import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import {
  bestPlanFor,
  getBrandVoice,
  getFlags,
  getPersona,
  insertScriptVideo,
} from "@/lib/server/db";
import { kickRenderWorker } from "@/lib/server/render";
import { llmComplete } from "@/lib/server/generate";
import { animSecondsLeft } from "@/lib/server/video-gen";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Campaign pack: one brief → three coherent videos queued at once — a
 * spokesperson (UGC) ad, an explainer, and a cinematic teaser — all sharing
 * the same props (the product rides in every frame). Honesty is enforced in
 * the writer: scripts may only claim what the brief itself says.
 */

const CAMPAIGN_SCHEMA = {
  type: "object",
  properties: {
    ad: { type: "string" },
    explainer: { type: "string" },
    teaser: { type: "string" },
  },
  required: ["ad", "explainer", "teaser"],
  additionalProperties: false,
};

const WRITER = [
  "You write video scripts for a marketing campaign. From the brief, write THREE scripts:",
  "- ad: 60-90 words, first person, conversational creator-ad style — a person recommending it to a friend. Hook in the first sentence.",
  "- explainer: 140-200 words, structured — problem, how it works, outcome, call to action.",
  "- teaser: 40-60 words, punchy and cinematic, ends on the product or brand name.",
  "HARD RULES: Use ONLY facts, numbers, and claims that appear in the brief itself. Never invent statistics, testimonials, awards, discounts, or urgency. Write for the ear — short sentences, no headings or stage directions.",
].join("\n");

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  // Three TTS + render jobs per run — keep it deliberate.
  const gate = rateLimit(`camp:${user.email}`, 2, 60 * 60 * 1000);
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
  const brief = String(b?.brief ?? "").trim().slice(0, 3000);
  if (brief.length < 30) {
    return NextResponse.json(
      { error: "Give the campaign a real brief — what it is, who it's for, what's true about it." },
      { status: 400 }
    );
  }
  const personaId = b?.personaId ? String(b.personaId) : "";
  const hasPersona = Boolean(personaId && getPersona(user.email, personaId));
  const propIds = Array.isArray(b?.propIds)
    ? (b.propIds as unknown[]).map(String).slice(0, 4).filter((id) => getPersona(user.email, id))
    : [];

  const voice = getBrandVoice(user.email);
  const res = await llmComplete(
    WRITER,
    `Campaign brief:\n${brief}${voice ? `\n\nBrand voice: tone ${JSON.stringify(voice)}` : ""}`,
    CAMPAIGN_SCHEMA as unknown as Record<string, unknown>,
    { tier: "flagship", maxTokens: 2000, context: "campaign-pack" }
  );
  if (!res) {
    return NextResponse.json(
      { error: "The writer is unavailable — check the AI key in the Operator Console and retry." },
      { status: 503 }
    );
  }
  let scripts: { ad: string; explainer: string; teaser: string };
  try {
    scripts = JSON.parse(res.text);
    if (!scripts.ad || !scripts.explainer || !scripts.teaser) throw new Error("incomplete");
  } catch {
    return NextResponse.json({ error: "Script writing failed — please retry." }, { status: 502 });
  }

  const animate = animSecondsLeft(bestPlanFor(user.email), user.email) > 0;
  const titleBase = brief.split(/[.!?\n]/)[0].trim().slice(0, 70) || "Campaign";
  const jobs: { title: string; script: string; vstyle?: string; personaId?: string }[] = [
    // No presenter → the ad renders cinematic rather than silently failing.
    hasPersona
      ? { title: `${titleBase} — Ad`, script: scripts.ad, vstyle: "ugc", personaId }
      : { title: `${titleBase} — Ad`, script: scripts.ad, vstyle: "cinematic" },
    { title: `${titleBase} — Explainer`, script: scripts.explainer, vstyle: "explainer" },
    { title: `${titleBase} — Teaser`, script: scripts.teaser, vstyle: "cinematic" },
  ];
  const clips = jobs.map((j) =>
    insertScriptVideo(user.email, {
      id: `sv-${crypto.randomUUID()}`,
      title: j.title,
      script: j.script.slice(0, 4800),
      style: "bold",
      position: "middle",
      animate,
      vstyle: j.vstyle,
      personaId: j.personaId,
      props: propIds,
    })
  );
  kickRenderWorker();
  return NextResponse.json(
    { clips: clips.length, usedPersona: hasPersona, engine: res.engine ?? undefined },
    { status: 201 }
  );
}

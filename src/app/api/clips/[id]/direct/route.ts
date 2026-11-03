import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getClip, getFlags } from "@/lib/server/db";
import { planDirFor, spokenOf, type FilmPlan } from "@/lib/server/render";
import { llmComplete } from "@/lib/server/generate";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Director's Notes: the intuitive edit layer. The creator writes what they
 * want in plain words ("music quieter in the lessons, re-shoot the ram so
 * it's clearly stuck, warmer look on the embrace"); an LLM translates that
 * into a checklist of the Cutting Room's existing operations. This endpoint
 * only PLANS — nothing executes until the creator reviews the steps and taps
 * Apply, and the client then calls the same endpoints the manual controls use.
 */

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["mix", "fx", "shot", "edit", "note"] },
          index: { type: ["integer", "null"] },
          label: { type: "string" },
          voice: { type: ["number", "null"] },
          music: { type: ["number", "null"] },
          amb: { type: ["number", "null"] },
          duck: { type: ["number", "null"] },
          grade: { type: ["string", "null"] },
          speed: { type: ["number", "null"] },
          freeze: { type: ["boolean", "null"] },
          fadeIn: { type: ["boolean", "null"] },
          fadeOut: { type: ["boolean", "null"] },
          size: { type: ["string", "null"] },
          angle: { type: ["string", "null"] },
          light: { type: ["string", "null"] },
          move: { type: ["string", "null"] },
          instruction: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
        },
        required: ["action", "index", "label"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

export interface DirectStep {
  action: "mix" | "fx" | "shot" | "edit" | "note";
  index: number | null;
  label: string;
  [k: string]: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Editing is temporarily disabled" }, { status: 503 });
  }
  const gate = rateLimit(`direct:${user.email}`, 30, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }
  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip?.hasPlan || clip.status !== "ready") {
    return NextResponse.json({ error: "No editable plan for this video" }, { status: 404 });
  }
  let plan: FilmPlan;
  try {
    plan = JSON.parse(fs.readFileSync(path.join(planDirFor(id), "plan.json"), "utf8")) as FilmPlan;
  } catch {
    return NextResponse.json({ error: "Plan unreadable" }, { status: 500 });
  }

  let instruction = "";
  try {
    instruction = String(((await req.json()) as Record<string, unknown>)?.instruction ?? "").trim();
  } catch {
    /* validated below */
  }
  if (instruction.length < 5) {
    return NextResponse.json({ error: "Describe the change you want" }, { status: 400 });
  }

  const mix = { voice: 1, music: 0.32, amb: 0.14, duck: 6, ...(plan.mix ?? {}) };
  const scenes = plan.beats
    .slice(0, 140)
    .map(
      (b) =>
        `#${b.i} [${b.kind}${b.song ? " song" : ""}${(b as { frame?: boolean }).frame ? " fireside" : ""}${b.fx?.grade ? ` grade:${b.fx.grade}` : ""}] ${spokenOf(b.text).slice(0, 70)}`
    )
    .join("\n");

  const res = await llmComplete(
    [
      "You translate a film creator's plain-language wishes into edit operations on their rendered film. Return JSON {\"steps\":[...]} — a short, surgical list; never invent edits they did not ask for.",
      "Operations (choose per wish):",
      "- mix (index:null): whole-film audio faders. Fields: voice 0.5-1.6, music 0-0.8, amb 0-0.5, duck 1-12. Only set fields the wish mentions; others null. Current mix is given — adjust FROM it (e.g. 'music quieter' => music about 60% of current).",
      "- fx (index required): one scene's look. grade one of warm|cool|night|golden|dream|'' (empty clears), speed 0.5|0.75|1|1.5|2, freeze true for a freeze-frame, fadeIn/fadeOut booleans. Null = leave unchanged.",
      "- shot (index required): RE-SHOOT a scene's image with new cinematography (costs a regeneration). size one of wide|medium|close-up|extreme close-up; angle one of eye level|low angle|high angle|overhead; light one of golden hour|night|soft daylight|dramatic; move one of none|push in|pull out|pan left|pan right|rise. Use when the wish changes framing, angle, lighting or camera move.",
      "- edit (index required): REGENERATE a scene's image from a plain-language change ('make the ram clearly stuck in the thorns') via instruction. Use when the wish changes the CONTENT of the picture (costs a regeneration).",
      "- note (index required): save a margin note; use only when they ask to note/remember something.",
      "label: 6-12 words, plain English, naming the scene by its content, so the creator can approve each step.",
      "Pick scene indexes from the scene list by matching the wish's description to scene text. If a wish targets several scenes (e.g. 'all the lesson moments'), emit one step per scene, max 8 steps total.",
    ].join("\n"),
    `Current mix: ${JSON.stringify(mix)}\n\nScenes:\n${scenes}\n\nCreator's wish: ${instruction}`,
    PLAN_SCHEMA as unknown as Record<string, unknown>,
    { tier: "standard", maxTokens: 1500, context: "direct" }
  );
  if (!res) return NextResponse.json({ error: "Planner unavailable — retry shortly" }, { status: 503 });

  let steps: DirectStep[] = [];
  try {
    const parsed = JSON.parse(res.text) as { steps?: DirectStep[] };
    steps = (parsed.steps ?? []).filter(
      (s) =>
        ["mix", "fx", "shot", "edit", "note"].includes(s.action) &&
        (s.action === "mix" || (typeof s.index === "number" && plan.beats.some((b) => b.i === s.index)))
    );
  } catch {
    return NextResponse.json({ error: "Could not plan that — try rephrasing" }, { status: 502 });
  }
  if (!steps.length) {
    return NextResponse.json({ error: "Nothing actionable found — try naming the scene or the change" }, { status: 422 });
  }
  return NextResponse.json({ steps: steps.slice(0, 8) });
}

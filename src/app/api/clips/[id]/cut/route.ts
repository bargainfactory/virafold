import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getClip, getFlags } from "@/lib/server/db";
import { planDirFor, renderBeatSegment, spliceFilm, type FilmPlan, type FilmBeat } from "@/lib/server/render";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The Cutting Room's manual controls — the parts of traditional editing that
 * survive a voice-locked, regenerate-don't-cut pipeline:
 *   GET  → the film's editing payload (beats, per-beat versions, mix, notes)
 *   POST → one op per call:
 *     mix    — the audio faders (voice/music/ambience gain, duck strength)
 *     fx     — per-beat grade / speed / freeze / manual Ken Burns / fades
 *     note   — the editor's margin note on a beat
 *     revert — switch a beat back to any previous take still on disk
 * Every op re-encodes only what it must and resplices; audio timing is never
 * touched, so captions and lipsync can't drift.
 */

function loadPlan(id: string): { dir: string; plan: FilmPlan } | null {
  const dir = planDirFor(id);
  try {
    return { dir, plan: JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")) as FilmPlan };
  } catch {
    return null;
  }
}

/** Every take of a beat still on disk — the non-destructive history. */
function versionsOf(dir: string, i: number): string[] {
  const names = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (
      f === `beat${i}.png` ||
      f === `beat${i}_fx.png` ||
      f.startsWith(`edit${i}_`) ||
      f === `anim${i}.mp4` ||
      f === `anim${i}_fx.mp4` ||
      f.startsWith(`animup${i}_`)
    ) {
      names.add(f);
    }
  }
  return [...names];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip?.hasPlan || !clip.outputPath) {
    return NextResponse.json({ error: "No editable plan for this video" }, { status: 404 });
  }
  const loaded = loadPlan(id);
  if (!loaded) return NextResponse.json({ error: "Plan unreadable" }, { status: 500 });
  const { dir, plan } = loaded;
  return NextResponse.json({
    wide: plan.wide === true,
    duration: plan.duration,
    lead: plan.lead ?? 0,
    mix: { voice: 1, music: 0.32, amb: 0.14, duck: 6, ...(plan.mix ?? {}) },
    hasMusic: Boolean(plan.music),
    hasAmbience: Boolean(plan.ambience),
    beats: plan.beats.map((b) => ({
      i: b.i,
      text: b.text,
      start: b.start,
      dur: b.dur,
      kind: b.kind,
      file: b.file,
      image: b.kind === "image" || b.kind === "arch",
      frame: b.frame === true,
      song: b.song === true,
      who: b.who ?? [],
      fx: b.fx ?? null,
      fadeIn: b.fadeIn === true,
      fadeOut: b.fadeOut === true,
      note: b.note ?? "",
      versions: versionsOf(dir, b.i),
    })),
  });
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
  const gate = rateLimit(`cut:${user.email}`, 60, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }
  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip?.hasPlan || clip.status !== "ready" || !clip.outputPath) {
    return NextResponse.json({ error: "No editable plan for this video" }, { status: 404 });
  }
  const loaded = loadPlan(id);
  if (!loaded) return NextResponse.json({ error: "Plan unreadable" }, { status: 500 });
  const { dir, plan } = loaded;
  const outAbs = path.join(process.cwd(), clip.outputPath);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const op = String(body.op ?? "");
  const save = () => fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan), "utf8");
  const beatOf = (): FilmBeat | null => {
    const i = Number(body.index);
    return plan.beats.find((x) => x.i === i) ?? null;
  };

  try {
    if (op === "mix") {
      plan.mix = {
        voice: Number(body.voice),
        music: Number(body.music),
        amb: Number(body.amb),
        duck: Number(body.duck),
      };
      save();
      await spliceFilm(dir, plan, outAbs); // re-mux only: segments untouched
      return NextResponse.json({ ok: true });
    }
    if (op === "note") {
      const b = beatOf();
      if (!b) return NextResponse.json({ error: "Unknown scene" }, { status: 400 });
      b.note = String(body.note ?? "").slice(0, 300);
      save(); // notes never re-encode anything
      return NextResponse.json({ ok: true });
    }
    if (op === "fx") {
      const b = beatOf();
      if (!b) return NextResponse.json({ error: "Unknown scene" }, { status: 400 });
      const fx = (body.fx ?? null) as FilmBeat["fx"] | null;
      if (fx === null) delete b.fx;
      else b.fx = fx;
      b.fadeIn = body.fadeIn === true;
      b.fadeOut = body.fadeOut === true;
      save();
      await renderBeatSegment(dir, plan, b);
      await spliceFilm(dir, plan, outAbs);
      return NextResponse.json({ ok: true });
    }
    if (op === "revert") {
      const b = beatOf();
      if (!b) return NextResponse.json({ error: "Unknown scene" }, { status: 400 });
      const file = String(body.file ?? "");
      // Only takes of THIS beat, by the exact naming the renderer uses — the
      // version list is the contract, nothing else on disk is reachable.
      const legal =
        file === `beat${b.i}.png` ||
        file === `beat${b.i}_fx.png` ||
        /^edit\d+_\d+\.png$/.test(file) && file.startsWith(`edit${b.i}_`) ||
        file === `anim${b.i}.mp4` ||
        file === `anim${b.i}_fx.mp4` ||
        /^animup\d+_[0-9a-f]+\.mp4$/.test(file) && file.startsWith(`animup${b.i}_`);
      if (!legal || !fs.existsSync(path.join(dir, file))) {
        return NextResponse.json({ error: "Unknown take" }, { status: 400 });
      }
      b.file = file;
      b.kind = file.endsWith(".mp4") ? "anim" : "image";
      save();
      await renderBeatSegment(dir, plan, b);
      await spliceFilm(dir, plan, outAbs);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: `Edit failed: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` },
      { status: 500 }
    );
  }
}

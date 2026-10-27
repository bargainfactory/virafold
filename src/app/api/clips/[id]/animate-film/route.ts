import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getClip, getFlags, updateClip, insertNotification, bestPlanFor } from "@/lib/server/db";
import { planDirFor, renderBeatSegment, spliceFilm, type FilmPlan, type FilmBeat } from "@/lib/server/render";
import { animateStill, ANIM_MODELS, animSecondsLeft } from "@/lib/server/video-gen";
import { getVideoStyle } from "@/lib/server/scenes";
import { rateLimit } from "@/lib/server/rate-limit";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Storyboard-first rendering, part two: a film rendered as stills (AI motion
 * off — the cheap reviewable draft) upgrades to full motion IN PLACE. Every
 * still beat is animated from its approved art, its segment re-encoded with
 * the same captions and camera plan, and the film re-spliced — audio, music
 * and timing untouched. Review for cents, animate once it's right.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  const gate = rateLimit(`animfilm:${user.email}`, 3, 60 * 60 * 1000);
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
  const dir = planDirFor(id);
  let plan: FilmPlan;
  try {
    plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")) as FilmPlan;
  } catch {
    return NextResponse.json({ error: "Plan unreadable" }, { status: 500 });
  }

  let body: { premium?: boolean } = {};
  try {
    body = (await req.json()) as { premium?: boolean };
  } catch {
    /* defaults */
  }
  const model = body.premium ? ANIM_MODELS.premium : ANIM_MODELS.lite;

  // Still beats with usable source art become moving shots.
  // Archival photos stay authentic — never AI-animated.
  const targets = plan.beats.filter(
    (b) => b.kind === "image" && fs.existsSync(path.join(dir, b.file)) && b.file.endsWith(".png")
  );
  if (targets.length === 0) {
    return NextResponse.json({ error: "This film has no still scenes to animate" }, { status: 400 });
  }
  const wanted = targets.reduce((s, b) => s + Math.min(15, Math.max(1, Math.ceil(b.dur))), 0);
  const left = animSecondsLeft(bestPlanFor(user.email), user.email);
  if (wanted > left) {
    return NextResponse.json(
      { error: `Not enough AI-motion allowance: this film needs ~${wanted}s, ${Math.max(0, Math.floor(left))}s left this month` },
      { status: 402 }
    );
  }

  const styleDef = getVideoStyle(clip.vstyle);
  updateClip(user.email, id, { status: "rendering" });
  const email = user.email;

  void (async () => {
    let done = 0;
    try {
      // Waves of 4 keep a feature's generations from stampeding the provider.
      for (let w = 0; w < targets.length; w += 4) {
        await Promise.all(
          targets.slice(w, w + 4).map(async (b: FilmBeat) => {
            try {
              const subject = b.text.slice(0, 120);
              const res = await animateStill({
                email,
                pngPath: path.join(dir, b.file),
                motion: styleDef
                  ? styleDef.motionPrompt(subject)
                  : `One camera move only: a slow, gentle drift across ${subject}, with soft natural ambient movement. Keep the scene's content, lighting and framing unchanged; add no new objects, no people, no text.`,
                durationSec: b.dur,
                model,
              });
              if (!res) return;
              const vname = `animup${b.i}_${crypto.randomBytes(3).toString("hex")}.mp4`;
              fs.copyFileSync(res.file, path.join(dir, vname));
              b.file = vname;
              b.kind = "anim";
              await renderBeatSegment(dir, plan, b);
              done++;
            } catch {
              /* this beat stays a still — the film remains whole */
            }
          })
        );
      }
      if (done > 0) {
        await spliceFilm(dir, plan, path.join(process.cwd(), clip.outputPath!));
        fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan), "utf8");
      }
      updateClip(email, id, { status: "ready" });
      insertNotification(email, {
        id: `n-${crypto.randomUUID()}`,
        title: "Film Animated",
        message:
          done > 0
            ? `"${clip.title}" is now full motion — ${done} of ${targets.length} scenes animated from your approved storyboard.`
            : `"${clip.title}": no scenes could be animated right now — the film is unchanged. Try again in a few minutes.`,
        time: "Just now",
        read: false,
        type: done > 0 ? "success" : "warning",
      });
    } catch (e) {
      updateClip(email, id, { status: "ready" });
      insertNotification(email, {
        id: `n-${crypto.randomUUID()}`,
        title: "Animate Film Failed",
        message: `"${clip.title}": ${String(e instanceof Error ? e.message : e).slice(0, 140)} — the existing film is untouched.`,
        time: "Just now",
        read: false,
        type: "warning",
      });
    }
  })();

  return NextResponse.json({ ok: true, animating: targets.length, estimatedSeconds: wanted });
}

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getAdminUser } from "@/lib/server/auth";
import { buildClipRenderPlan, runFfmpeg } from "@/lib/server/render";
import type { TranscriptWord } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Render regression: runs the REAL clip-render recipe (buildClipRenderPlan —
 * the exact code renderOne executes) against a committed, genuinely
 * variable-frame-rate fixture, with and without the tight cut, and asserts
 * duration, constant output framerate, and audio presence. This is the gate
 * that would have caught the VFR-stutter bug before users did. Run it from
 * the console after any renderer change.
 */

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function probe(file: string): { dur: number; avgFps: string; rFps: string; hasAudio: boolean } {
  const f = (args: string[]) =>
    spawnSync("ffprobe", ["-v", "error", ...args, file], { encoding: "utf8" }).stdout.trim();
  const dur = parseFloat(f(["-show_entries", "format=duration", "-of", "default=nw=1:nk=1"]));
  const fps = f(["-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "default=nw=1"]);
  const audio = f(["-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "default=nw=1:nk=1"]);
  const avg = /avg_frame_rate=([^\n]+)/.exec(fps)?.[1] ?? "?";
  const r = /r_frame_rate=([^\n]+)/.exec(fps)?.[1] ?? "?";
  return { dur: Number.isFinite(dur) ? dur : 0, avgFps: avg, rFps: r, hasAudio: audio === "audio" };
}

// Scripted word track with two real dead-air gaps (3.0→4.4 and 7.6→9.1),
// so the tight cut has something honest to remove.
function fixtureWords(): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  const spans: [number, number][] = [
    [0.3, 3.0],
    [4.4, 7.6],
    [9.1, 11.6],
  ];
  for (const [a, b] of spans) {
    for (let t = a; t < b - 0.05; t += 0.3) {
      words.push({ w: "word", s: Number(t.toFixed(2)), e: Number((t + 0.24).toFixed(2)) });
    }
  }
  return words;
}

export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const fixture = path.join(process.cwd(), "fixtures", "vfr-test.mp4");
  if (!fs.existsSync(fixture)) {
    return NextResponse.json({ error: "fixtures/vfr-test.mp4 missing from the deploy" }, { status: 500 });
  }

  const jobDir = path.join(process.cwd(), "data", "renders", "tmp-regression");
  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(jobDir, { recursive: true });
  const checks: Check[] = [];

  try {
    const words = fixtureWords();
    for (const tight of [false, true]) {
      const outAbs = path.join(jobDir, `out-${tight ? "tight" : "plain"}.mp4`);
      const plan = buildClipRenderPlan({
        srcAbs: fixture,
        outAbs,
        startSec: 0,
        endSec: 12,
        words,
        style: "bold",
        position: "bottom",
        focus: "center",
        tight,
        watermark: tight, // exercise the watermark path once too
      });
      fs.writeFileSync(path.join(jobDir, "subs.ass"), plan.ass, "utf8");
      const r = await runFfmpeg(plan.args, jobDir);
      const label = tight ? "tight cut on VFR source" : "plain render on VFR source";
      if (r.code !== 0) {
        checks.push({ name: label, pass: false, detail: `ffmpeg exited ${r.code}: ${r.err.slice(-160)}` });
        continue;
      }
      const p = probe(outAbs);
      if (!tight) {
        const ok = Math.abs(p.dur - 12) <= 0.4 && p.hasAudio;
        checks.push({
          name: label,
          pass: ok,
          detail: `duration ${p.dur.toFixed(2)}s (want ~12), audio ${p.hasAudio ? "yes" : "MISSING"}`,
        });
      } else {
        // The gaps (~2.9s raw, less padding) must actually be cut, the
        // output must be constant 30fps (the VFR bug signature is a
        // mismatched/odd avg), and audio must survive the aselect.
        const durOk = Math.abs(p.dur - plan.effDur) <= 0.45 && p.dur <= 10.5 && plan.cut;
        const fpsOk = p.avgFps === "30/1" && p.rFps === "30/1";
        checks.push({
          name: label,
          pass: durOk && fpsOk && p.hasAudio,
          detail: `duration ${p.dur.toFixed(2)}s (plan ${plan.effDur.toFixed(2)}s), fps avg=${p.avgFps} nominal=${p.rFps} (want 30/1), audio ${p.hasAudio ? "yes" : "MISSING"}`,
        });
      }
    }
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }

  return NextResponse.json({ pass: checks.every((c) => c.pass), checks });
}

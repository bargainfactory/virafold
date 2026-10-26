/**
 * Clip rendering: ffmpeg turns a stored source video + word timestamps into a
 * 1080x1920 vertical clip with burned-in captions (libass).
 *
 * Design constraints:
 * - CPU-bound on a small VPS → a single in-process worker renders one clip at
 *   a time off the DB queue; the scheduler tick re-kicks it after restarts.
 * - The .ass subtitle file sits in a per-job temp dir and ffmpeg runs with
 *   cwd there, so the filtergraph references a bare filename — no path
 *   escaping issues on either Windows (drive colons) or Linux.
 * - No ffmpeg installed (e.g. a fresh dev box) fails the job with a clear
 *   message instead of crashing anything.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  bestPlanFor,
  getProjectMedia,
  insertNotification,
  listQueuedClips,
  updateClip,
  type Clip,
  type TranscriptWord,
} from "./db";
import { estimateWords } from "./clips";

export const CAPTION_STYLES = ["bold", "neon", "clean"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

const RENDERS_DIR = path.join(process.cwd(), "data", "renders");

/** Brand watermark as an ASS style + full-length event — libass is proven on
 *  every box we run on, unlike drawtext's fontconfig dependence. Free-plan
 *  renders carry it; any paid plan removes it (the pricing page's promise). */
function withWatermark(ass: string, dims: { w: number; h: number }, duration: number): string {
  const wmSize = Math.max(14, Math.round(dims.h * 0.024));
  const m = Math.max(10, Math.round(dims.h * 0.012));
  const out = ass.replace(
    "\n\n[Events]",
    `\nStyle: WM,DejaVu Sans,${wmSize},&H50FFFFFF,&H50FFFFFF,&H60000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,3,${m},${m},${m},1\n\n[Events]`
  );
  return out + `Dialogue: 1,${fmtAssTime(0)},${fmtAssTime(duration)},WM,,0,0,0,,virafold.ai\n`;
}

/** Renders for Free-plan users carry the watermark. */
function needsWatermark(email: string): boolean {
  try {
    return bestPlanFor(email) === "Free";
  } catch {
    return false;
  }
}

function fmtAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${rest}`;
}

function assEscape(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
}

export const CAPTION_POSITIONS = ["top", "middle", "bottom"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

export const CROP_FOCUSES = ["left", "center", "right"] as const;
export type CropFocus = (typeof CROP_FOCUSES)[number];

// &HAABBGGRR — libass color order. DejaVu Sans ships with the server's ffmpeg
// (fontconfig falls back sensibly where it doesn't exist). MarginV/Alignment
// are composed per caption position — talking-head clips want captions off
// the speaker's face. Sizes are authored for a 1080x1920 canvas and scaled
// by PlayRes height for other frames (the caption-only mode keeps the
// source's own dimensions).
const STYLE_BASE: Record<
  CaptionStyle,
  {
    size: number;
    colors: string;
    bold: number;
    outline: number;
    shadow: number;
    bottomMarginV: number;
    wordsPerChunk: number;
    upper: boolean;
  }
> = {
  bold: {
    size: 96,
    colors: "&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000",
    bold: 1,
    outline: 7,
    shadow: 0,
    bottomMarginV: 640,
    wordsPerChunk: 3,
    upper: true,
  },
  neon: {
    size: 88,
    colors: "&H00FFFFFF,&H00FFFFFF,&H00F755A8,&H80000000",
    bold: 1,
    outline: 5,
    shadow: 2,
    bottomMarginV: 640,
    wordsPerChunk: 3,
    upper: false,
  },
  clean: {
    size: 64,
    colors: "&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000",
    bold: 0,
    outline: 3,
    shadow: 0,
    bottomMarginV: 260,
    wordsPerChunk: 4,
    upper: false,
  },
};

export interface PlayRes {
  w: number;
  h: number;
}

function styleLine(style: CaptionStyle, position: CaptionPosition, res: PlayRes): string {
  const base = STYLE_BASE[style] ?? STYLE_BASE.bold;
  const k = res.h / 1920;
  const size = Math.max(18, Math.round(base.size * k));
  const outline = Math.max(1, Math.round(base.outline * k));
  const shadow = Math.round(base.shadow * k);
  const marginLR = Math.round(60 * k);
  // ASS numpad alignment: 8 = top-center, 5 = middle-center, 2 = bottom-center.
  // Portrait "bottom" rides high to clear the Shorts UI; landscape is a
  // cinema frame, so bottom means a true subtitle margin near the edge.
  const wide = res.w > res.h;
  const [align, marginV] =
    position === "top"
      ? [8, Math.round((wide ? 90 : 140) * k)]
      : position === "middle"
        ? [5, 0]
        : [2, wide ? Math.round(64 * (res.h / 1080)) : Math.round(base.bottomMarginV * k)];
  return `Style: Default,DejaVu Sans,${size},${base.colors},${base.bold},0,0,0,100,100,0,0,1,${outline},${shadow},${align},${marginLR},${marginLR},${marginV},1`;
}

/** Build the .ass subtitle document for one clip window. */
export function buildAss(
  words: TranscriptWord[],
  clipStart: number,
  clipEnd: number,
  style: CaptionStyle,
  position: CaptionPosition = "bottom",
  res: PlayRes = { w: 1080, h: 1920 }
): string {
  const cfg = STYLE_BASE[style] ?? STYLE_BASE.bold;
  const inRange = words.filter((w) => w.e > clipStart && w.s < clipEnd);

  // Dialogue speakers each get a caption tint (ASS colors are &HBBGGRR) so
  // kids can track who's talking even on mute; narration stays style-default.
  const SPEAKER_TINTS = ["3CB6F2", "F0D75A", "D26AF0", "A8E07F"];

  const events: string[] = [];
  let chunk: TranscriptWord[] = [];
  const flush = () => {
    if (!chunk.length) return;
    const start = Math.max(0, chunk[0].s - clipStart);
    const end = Math.min(clipEnd - clipStart, chunk[chunk.length - 1].e - clipStart);
    if (end > start) {
      if (chunk[0].k) {
        // Sing-along karaoke: song words fill word-by-word as they're sung
        // (ASS \k sweeps SecondaryColour → PrimaryColour), slightly enlarged,
        // gold on white — kids can sing along like a bouncing ball.
        const parts = chunk.map((w, j) => {
          const next = chunk[j + 1];
          const cs = Math.max(1, Math.round(((next ? next.s : w.e) - w.s) * 100));
          let t = assEscape(w.w);
          if (cfg.upper) t = t.toUpperCase();
          return `{\\k${cs}}${t}${j < chunk.length - 1 ? " " : ""}`;
        });
        events.push(
          `Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Default,,0,0,0,,{\\fscx118\\fscy118}{\\1c&H3CD7F0&}{\\2c&HFFFFFF&}${parts.join("")}`
        );
      } else {
        let text = assEscape(chunk.map((w) => w.w).join(" "));
        if (cfg.upper) text = text.toUpperCase();
        if (text) {
          const sp = chunk[0].sp;
          const tint =
            sp !== undefined ? `{\\1c&H${SPEAKER_TINTS[sp % SPEAKER_TINTS.length]}&}` : "";
          events.push(
            `Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Default,,0,0,0,,${tint}${text}`
          );
        }
      }
    }
    chunk = [];
  };
  // Landscape features read like cinema subtitles: wider caption lines than
  // the punchy 3-word chunks tuned for vertical Shorts.
  const chunkWords = res.w > res.h ? cfg.wordsPerChunk + 3 : cfg.wordsPerChunk;
  for (const w of inRange) {
    // A speaker change (diarized interviews) always starts a fresh caption,
    // and song words never share a caption with spoken ones (karaoke chunks).
    if (chunk.length && w.sp !== undefined && w.sp !== chunk[chunk.length - 1].sp) flush();
    if (chunk.length && (w.k ? 1 : 0) !== (chunk[chunk.length - 1].k ? 1 : 0)) flush();
    chunk.push(w);
    const dur = chunk[chunk.length - 1].e - chunk[0].s;
    if (chunk.length >= chunkWords || dur >= (res.w > res.h ? 3.2 : 2.2)) flush();
  }
  flush();

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${res.w}`,
    `PlayResY: ${res.h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine(style, position, res),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/**
 * Plain SRT closed captions from word timings (offset = the title-card lead),
 * grouped into ~7-word cues — uploaded to YouTube alongside the published
 * video so the burned-in captions get a real, searchable caption track too.
 */
export function srtFromWords(words: TranscriptWord[], offset = 0): string {
  const fmt = (t: number) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  const cues: string[] = [];
  let chunk: TranscriptWord[] = [];
  const flush = () => {
    if (!chunk.length) return;
    const text = chunk.map((w) => w.w).join(" ").trim();
    if (text) {
      cues.push(
        `${cues.length + 1}\n${fmt(chunk[0].s + offset)} --> ${fmt(chunk[chunk.length - 1].e + offset)}\n${text}\n`
      );
    }
    chunk = [];
  };
  for (const w of words) {
    if (chunk.length && w.sp !== undefined && w.sp !== chunk[chunk.length - 1].sp) flush();
    chunk.push(w);
    if (chunk.length >= 7 || chunk[chunk.length - 1].e - chunk[0].s >= 3.2) flush();
  }
  flush();
  return cues.join("\n");
}

/** Video frame dimensions via ffprobe; null when unreadable. */
export async function probeDims(absPath: string): Promise<PlayRes | null> {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "csv=p=0",
          absPath,
        ],
        { windowsHide: true }
      );
    } catch {
      resolve(null);
      return;
    }
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const [w, h] = out.trim().split(",").map((n) => parseInt(n, 10));
      resolve(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null);
    });
  });
}

/**
 * Caption-only render: the source video returned uncut at its own size with
 * captions burned in — the most-searched feature in the space, and for this
 * pipeline just a render mode that skips the crop. Optional watermark for
 * the anonymous free tool.
 */
export async function renderCaptionOnly(
  srcAbs: string,
  words: TranscriptWord[],
  style: CaptionStyle,
  position: CaptionPosition,
  outAbs: string,
  opts: { watermark?: boolean } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dims = (await probeDims(srcAbs)) ?? { w: 1920, h: 1080 };
  const duration = (await probeDuration(srcAbs)) ?? 0;
  if (!duration) return { ok: false, error: "could not read the video" };

  const jobDir = path.join(RENDERS_DIR, `tmp-cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(jobDir, { recursive: true });
  try {
    let ass = buildAss(words, 0, duration, style, position, dims);
    if (opts.watermark) ass = withWatermark(ass, dims, duration);
    fs.writeFileSync(path.join(jobDir, "subs.ass"), ass, "utf8");
    const vf = "ass=subs.ass";
    const res = await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        srcAbs,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        outAbs,
      ],
      jobDir
    );
    if (res.code !== 0 || !fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
      return {
        ok: false,
        error: res.err.includes("ENOENT")
          ? "ffmpeg is not installed on this server"
          : `render failed: ${res.err.slice(-200)}`,
      };
    }
    return { ok: true };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    let err = "";
    let child;
    try {
      // Renders are CPU-bound; deprioritize them on the shared box so live
      // web requests always win the scheduler.
      const [bin, argv] =
        process.platform === "win32" ? [cmd, args] : ["nice", ["-n", "15", cmd, ...args]];
      child = spawn(bin, argv, { cwd, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, err: String(e) });
      return;
    }
    child.stderr?.on("data", (d) => {
      err += String(d);
      if (err.length > 8000) err = err.slice(-8000);
    });
    child.on("error", (e) => resolve({ code: -1, err: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? -1, err }));
  });
}

/** Media duration via ffprobe; null when unavailable. */
export async function probeDuration(absPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absPath],
        { windowsHide: true }
      );
    } catch {
      resolve(null);
      return;
    }
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}

/**
 * Bolt-style tight cut: the speech runs inside the clip window, silences
 * longer than GAP removed, PAD kept around each run so words never clip.
 * Returns null when there's nothing worth cutting (or no usable words) —
 * the render then proceeds untouched.
 */
// 0.5s keeps natural breath pauses and only removes true dead air — tighter
// values made normal speech feel like it was skipping.
const TIGHT_GAP = 0.5;
const TIGHT_PAD = 0.12;

function tightSegments(
  words: TranscriptWord[],
  start: number,
  end: number
): { a: number; b: number }[] | null {
  const inWin = words
    .filter((w) => w.e > start && w.s < end)
    .sort((x, y) => x.s - y.s);
  if (inWin.length < 3) return null;

  const runs: { a: number; b: number }[] = [];
  let cur = { a: inWin[0].s, b: inWin[0].e };
  for (let i = 1; i < inWin.length; i++) {
    const w = inWin[i];
    if (w.s - cur.b > TIGHT_GAP) {
      runs.push(cur);
      cur = { a: w.s, b: w.e };
    } else {
      cur.b = Math.max(cur.b, w.e);
    }
  }
  runs.push(cur);

  // Pad, clamp to the window, merge any overlaps padding created.
  const padded = runs.map((r) => ({
    a: Math.max(start, r.a - TIGHT_PAD),
    b: Math.min(end, r.b + TIGHT_PAD),
  }));
  const merged: { a: number; b: number }[] = [];
  for (const r of padded) {
    const last = merged[merged.length - 1];
    if (last && r.a <= last.b + 0.01) last.b = Math.max(last.b, r.b);
    else merged.push({ ...r });
  }

  const kept = merged.reduce((s, r) => s + (r.b - r.a), 0);
  const removed = end - start - kept;
  // Below a quarter second the cut isn't worth a re-timed caption track.
  if (removed < 0.25 || kept < 1) return null;
  return merged;
}

/** Absolute time → its position on the tightened timeline (window-relative
 *  removal compressed out). Times inside a removed gap snap to the gap edge. */
function compressTime(t: number, segs: { a: number; b: number }[]): number {
  let out = 0;
  for (const s of segs) {
    if (t <= s.a) return out;
    out += Math.min(t, s.b) - s.a;
    if (t <= s.b) return out;
  }
  return out;
}

/**
 * The clip render recipe — extracted pure so the regression route exercises
 * the EXACT production filter construction (the VFR-stutter bug lived here;
 * a replica test would have passed while the real path failed).
 */
export function buildClipRenderPlan(opts: {
  srcAbs: string;
  outAbs: string;
  startSec: number;
  endSec: number;
  words: TranscriptWord[];
  style: CaptionStyle;
  position: CaptionPosition;
  focus: string;
  tight: boolean;
  watermark: boolean;
}): { args: string[]; ass: string; effDur: number; cut: boolean } {
  // Tight cut (default on): drop dead air >0.5s inside the clip window —
  // the retention tactic from the Mathis Bolt playbook. Captions are
  // re-timed onto the compressed timeline so they stay in sync.
  const segs = opts.tight ? tightSegments(opts.words, opts.startSec, opts.endSec) : null;
  let effWords = opts.words;
  let effDur = Math.max(1, opts.endSec - opts.startSec);
  if (segs) {
    effDur = Math.max(1, segs.reduce((s, r) => s + (r.b - r.a), 0));
    effWords = opts.words
      .filter((w) => w.e > opts.startSec && w.s < opts.endSec)
      .map((w) => ({
        ...w,
        s: opts.startSec + compressTime(w.s, segs),
        e: opts.startSec + Math.max(compressTime(w.e, segs), compressTime(w.s, segs) + 0.05),
      }));
  }

  let ass = buildAss(effWords, opts.startSec, opts.startSec + effDur, opts.style, opts.position);
  if (opts.watermark) {
    ass = withWatermark(ass, { w: 1080, h: 1920 }, effDur);
  }

  // Crop focus: where the subject sits in the source frame — left, center,
  // or right slice of the 9:16 cut (the pragmatic talking-head fix until
  // true face tracking).
  const cropX = opts.focus === "left" ? "0" : opts.focus === "right" ? "iw-ow" : "(iw-ow)/2";
  let vf = `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':${cropX}:'(ih-oh)/2',scale=1080:1920`;
  const args = ["-y", "-ss", String(opts.startSec), "-i", opts.srcAbs, "-t",
    String(Math.max(1, opts.endSec - opts.startSec))];
  if (segs) {
    // -ss before -i resets timestamps, so select() sees window-relative t.
    // fps=30 FIRST: phone sources are variable-frame-rate, and re-timing
    // with N/FRAME_RATE on VFR makes playback stutter/skip — force CFR,
    // then re-time against the known rate.
    const expr = segs
      .map((r) => `between(t,${(r.a - opts.startSec).toFixed(3)},${(r.b - opts.startSec).toFixed(3)})`)
      .join("+");
    vf += `,fps=30,select='${expr}',setpts=N/(30*TB)`;
    args.push("-af", `aselect='${expr}',asetpts=N/SR/TB`);
  }
  vf += ",ass=subs.ass";
  args.push(
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    opts.outAbs
  );
  return { args, ass, effDur, cut: !!segs };
}

/** The regression route needs the same nice-wrapped ffmpeg runner. */
export async function runFfmpeg(
  args: string[],
  cwd: string
): Promise<{ code: number; err: string }> {
  return run("ffmpeg", args, cwd);
}

async function renderOne(clip: Clip & { userEmail: string }): Promise<void> {
  const media = getProjectMedia(clip.userEmail, clip.projectId);
  if (!media?.storagePath) throw new Error("source video is no longer stored for this project");
  const srcAbs = path.join(process.cwd(), media.storagePath);
  if (!fs.existsSync(srcAbs)) throw new Error("source video file is missing on disk");

  const duration = media.durationSec ?? (await probeDuration(srcAbs));
  const words =
    media.words ??
    (media.transcript && duration ? estimateWords(media.transcript, duration) : []);

  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const jobDir = path.join(RENDERS_DIR, `tmp-${clip.id}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const outAbs = path.join(RENDERS_DIR, `${clip.id}.mp4`);

  try {
    const plan = buildClipRenderPlan({
      srcAbs,
      outAbs,
      startSec: clip.startSec,
      endSec: clip.endSec,
      words,
      style: clip.style as CaptionStyle,
      position: clip.position as CaptionPosition,
      focus: clip.focus,
      tight: clip.tight !== 0,
      watermark: needsWatermark(clip.userEmail),
    });
    fs.writeFileSync(path.join(jobDir, "subs.ass"), plan.ass, "utf8");
    const res = await run("ffmpeg", plan.args, jobDir);
    if (res.code !== 0) {
      const missing = res.err.includes("ENOENT");
      throw new Error(
        missing
          ? "ffmpeg is not installed on this server"
          : `ffmpeg exited ${res.code}: ${res.err.slice(-300)}`
      );
    }
    if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
      throw new Error("render produced no output");
    }
    updateClip(clip.userEmail, clip.id, {
      status: "ready",
      outputPath: path.relative(process.cwd(), outAbs),
      error: null,
    });
    insertNotification(clip.userEmail, {
      id: `n-${crypto.randomUUID()}`,
      title: "Clip Ready",
      message: `"${clip.title}" rendered with captions — preview, download, or schedule it from Clip Studio.`,
      time: "Just now",
      read: false,
      type: "success",
    });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/**
 * Script video: TTS narration + animated waveform + burned captions over a
 * branded dark canvas — a complete faceless video from typed text, no
 * recording involved. Enters the same queue and delivery path as clips.
 */
// --- Forced alignment ---
//
// The gold standard for caption sync: run speech-to-text on the narration we
// just generated and use its word-level timestamps, so every caption word
// lands on the instant it is spoken. Costs about a cent per render on the
// existing STT chain; estimates remain the fallback when no STT key is up.

async function alignNarration(jobDir: string, voiceFile: string): Promise<TranscriptWord[] | null> {
  try {
    const { transcribeMedia } = await import("./transcribe");
    const abs = path.join(jobDir, voiceFile);
    let sendAbs = abs;
    let name = voiceFile;
    let mime = voiceFile.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
    // Long WAVs exceed some providers' upload caps — align on a small mp3.
    if (fs.statSync(abs).size > 24 * 1024 * 1024) {
      const small = path.join(jobDir, "align.mp3");
      const tr = await run(
        "ffmpeg",
        ["-y", "-i", abs, "-ac", "1", "-b:a", "64k", "align.mp3"],
        jobDir
      );
      if (tr.code !== 0 || !fs.existsSync(small)) return null;
      sendAbs = small;
      name = "align.mp3";
      mime = "audio/mpeg";
    }
    const res = await transcribeMedia(fs.readFileSync(sendAbs), name, mime);
    if (!res?.words?.length) return null;
    return res.words.map((w) => ({ w: w.w, s: w.s, e: w.e }));
  } catch {
    return null;
  }
}

// --- Segmented film assembly (the scene editor's foundation) ---
//
// Each beat renders as its own small segment (identical codec params), the
// film is assembled by stream-copy concat, and the whole build plan persists
// next to the output. Editing one scene later = rebuild one segment + splice,
// seconds instead of hours. Frame counts are cumulative-exact so 60+ segments
// never drift against the measured audio timeline.

export interface FilmBeat {
  i: number;
  text: string;
  start: number;
  dur: number;
  kind: string;
  file: string;
  /** The exact image prompt used (re-roll fuel); empty for broll/cards/arch. */
  prompt: string;
  /** Storytelling-frame beat (the fireside) — drives the ambience layer. */
  frame?: boolean;
  /** Sung beat (a song run) — its captions render as sing-along karaoke. */
  song?: boolean;
}

export interface FilmPlan {
  style: string;
  position: string;
  watermark: boolean;
  look: boolean;
  voiceFile: string;
  duration: number;
  words: TranscriptWord[];
  beats: FilmBeat[];
  lang?: string;
  /** Widescreen 16:9 motion picture instead of the 9:16 vertical default. */
  wide?: boolean;
  /** "straight" = studio cut grammar: no per-beat fades (cards carry them). */
  cuts?: string;
  /** "v2" = directed camera pass on still beats (eased mood-matched moves). */
  camera?: string;
  /** Mood-mapped score track in the plan dir, mixed under the narration. */
  music?: string;
  /** Synthesized ambience/foley track (fireside crackle, wind, waves) in the
   *  plan dir, mixed very low under everything. */
  ambience?: string;
  /** Branded title/end card segments and the timeline they add around the voice. */
  openCard?: string;
  endCard?: string;
  lead?: number;
  tail?: number;
}

/** Output canvas for a plan — vertical Short or widescreen feature. */
function planResOf(plan: FilmPlan): PlayRes {
  return plan.wide ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}

const CINE_LOOK =
  "curves=blue='0/0.06 0.5/0.47 1/0.92':red='0/0.02 0.5/0.53 1/1',eq=contrast=1.06:saturation=1.08,";

// Camera pass v2: still beats get directed moves instead of one flat zoom —
// eased (smoothstep) with a short hold before the move starts, magnitude and
// character chosen by the scene's mood (shared with the score), move TYPE
// matched to the shot in the framing rotation (wides drift laterally,
// close-ups push, reveals rise, three-quarters travel diagonally), zooms
// anchored center (the old default drifted toward the top-left corner),
// a slow Dutch tilt under tension, and a brief jolt on impact beats.
const IMPACT_RE = /\b(fell|falling|crash(ed)?|thunder|struck|slammed|shook|burst|collapsed|toppled)\b/i;

function cameraV2(b: FilmBeat, frames: number, R: PlayRes, mood: string): string {
  const W = R.w, H = R.h;
  const OW = 2 * Math.round((W * 1.08) / 2);
  const OH = 2 * Math.round((H * 1.08) / 2);
  const hold = Math.min(15, Math.floor(frames / 4));
  const span = Math.max(1, frames - 1 - hold);
  const P = `min(1,max(0,(on-${hold})/${span}))`;
  const E = `(${P}*${P}*(3-2*${P}))`;
  const mag =
    mood === "tension" ? 0.06
      : mood === "sorrow" || mood === "night" ? 0.05
        : mood === "joy" ? 0.16
          : mood === "wonder" ? 0.14
            : mood === "majesty" || mood === "travel" ? 0.12
              : 0.1;
  const out = b.i % 2 === 1; // alternate push and pull across beats
  const zIn = `1+${mag.toFixed(3)}*${E}`;
  const zOut = `${(1 + mag).toFixed(3)}-${mag.toFixed(3)}*${E}`;
  let z = out ? zOut : zIn;
  let x = `iw/2-(iw/zoom/2)`;
  let y = `ih/2-(ih/zoom/2)`;
  const shot = b.i % 5;
  if (shot === 0) {
    // Wide: constant gentle zoom, the landscape slides past laterally.
    z = (1 + mag * 0.7).toFixed(3);
    x = out ? `(iw-iw/zoom)*(1-${E})` : `(iw-iw/zoom)*${E}`;
  } else if (shot === 3) {
    // Reveal: the camera rises through the frame while pushing in.
    z = zIn;
    y = `(ih-ih/zoom)*(1-${E})`;
  } else if (shot === 4) {
    // Three-quarter: diagonal travel from one corner's story to the other's.
    z = (1 + mag).toFixed(3);
    x = out ? `(iw-iw/zoom)*(1-${E})` : `(iw-iw/zoom)*${E}`;
    y = out ? `(ih-ih/zoom)*${E}` : `(ih-ih/zoom)*(1-${E})`;
  }
  const scale2 = `scale=${OW}:${OH}:force_original_aspect_ratio=increase,crop=${OW}:${OH}`;
  const zp = `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${OW}x${OH}:fps=30`;
  const secs = (frames / 30).toFixed(2);
  const tilt =
    mood === "tension" && (shot === 1 || shot === 2)
      ? `rotate=a='0.045*min(1\\,t/${secs})':ow=${OW}:oh=${OH}:c=black,`
      : "";
  const jolt = IMPACT_RE.test(b.text)
    ? `crop=${W}:${H}:x='(iw-${W})/2+if(lt(n,12),9*sin(n*12.9),0)':y='(ih-${H})/2+if(lt(n,12),6*sin(n*17.3),0)'`
    : `crop=${W}:${H}:x='(iw-${W})/2':y='(ih-${H})/2'`;
  return `${scale2},${zp},${tilt}${jolt}`;
}

function beatFrames(plan: FilmPlan, b: FilmBeat): number {
  const startF = Math.round(b.start * 30);
  const endF =
    b.i === plan.beats.length - 1 ? Math.round(plan.duration * 30) : Math.round((b.start + b.dur) * 30);
  return Math.max(15, endF - startF);
}

export async function renderBeatSegment(planDir: string, plan: FilmPlan, b: FilmBeat): Promise<void> {
  const frames = beatFrames(plan, b);
  const dur = frames / 30;
  const R = planResOf(plan);
  let ass = buildAss(
    plan.words,
    b.start,
    b.start + dur,
    plan.style as CaptionStyle,
    plan.position as CaptionPosition,
    R
  );
  if (plan.watermark) ass = withWatermark(ass, R, dur);
  const assName = `seg_${b.i}.ass`;
  fs.writeFileSync(path.join(planDir, assName), ass, "utf8");

  const look = plan.look && b.kind !== "stat" && b.kind !== "chart" && b.kind !== "list" && b.kind !== "quote" ? CINE_LOOK : "";
  // Studio cut grammar: straight cuts between scenes (the title and end cards
  // carry the film's fades). Legacy plans keep their per-beat fades so a
  // re-rendered scene still matches its neighbors.
  const fades =
    plan.cuts === "straight"
      ? "null"
      : `fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0.4, dur - 0.3).toFixed(2)}:d=0.3`;
  const scale = `scale=${R.w}:${R.h}:force_original_aspect_ratio=increase,crop=${R.w}:${R.h}`;
  let inputs: string[];
  let fc: string;
  if (b.kind === "broll" || b.kind === "anim" || b.kind === "speak") {
    inputs = ["-stream_loop", "-1", "-t", (dur + 0.5).toFixed(2), "-i", b.file];
    fc = `[0:v]${scale},fps=30,${look}${fades},setsar=1,ass=${assName}[v]`;
  } else if (b.kind === "image" || b.kind === "arch") {
    inputs = ["-i", b.file];
    if (plan.camera === "v2") {
      const { sceneMood } = await import("./music");
      fc = `[0:v]${cameraV2(b, frames, R, sceneMood(b.text))},${look}vignette=PI/5,noise=alls=5:allf=t,${fades},setsar=1,ass=${assName}[v]`;
    } else {
      const zoom =
        b.i % 2 === 0
          ? `zoompan=z='min(zoom+0.0012,1.12)':d=${frames}:s=${R.w}x${R.h}:fps=30`
          : `zoompan=z='if(eq(on,1),1.12,max(zoom-0.0012,1.0))':d=${frames}:s=${R.w}x${R.h}:fps=30`;
      fc = `[0:v]${scale},${zoom},${look}vignette=PI/5,noise=alls=5:allf=t,${fades},setsar=1,ass=${assName}[v]`;
    }
  } else {
    inputs = ["-loop", "1", "-t", (dur + 0.3).toFixed(2), "-framerate", "30", "-i", b.file];
    fc =
      `[0:v]${scale},fps=30,split[sa][sb];[sa]lutyuv=y=val*0.25[dim];` +
      `[sb][dim]overlay=x='min(W,W*t/0.8)':y=0,${fades},setsar=1,ass=${assName}[v]`;
  }
  const res = await run(
    "ffmpeg",
    ["-y", ...inputs, "-filter_complex", fc, "-map", "[v]", "-frames:v", String(frames),
     "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-an",
     `seg_${b.i}.mp4`],
    planDir
  );
  const segAbs = path.join(planDir, `seg_${b.i}.mp4`);
  if (res.code !== 0 || !fs.existsSync(segAbs) || fs.statSync(segAbs).size === 0) {
    throw new Error(`segment ${b.i} failed: ${res.err.slice(-200)}`);
  }
}

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/**
 * Branded title and end cards: indigo night cards with the series name and
 * episode title, encoded with the segments' exact codec params so the
 * stream-copy concat accepts them. Returns the lead/tail they add, or null
 * when card generation fails (the film then plays without cards).
 */
export async function makeFilmCards(
  planDir: string,
  plan: FilmPlan,
  title: string
): Promise<{ openCard: string; endCard: string; lead: number; tail: number } | null> {
  try {
    const R = planResOf(plan);
    const em = title.includes(" — ") ? title.indexOf(" — ") : -1;
    const brand = em > 0 ? title.slice(0, em) : "";
    // Cards drop trailing parentheticals ("(Motion Picture)") — version notes,
    // not title material.
    const main = (em > 0 ? title.slice(em + 3) : title).replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
    fs.writeFileSync(path.join(planDir, "card_main.txt"), main, "utf8");
    fs.writeFileSync(path.join(planDir, "card_brand.txt"), brand || " ", "utf8");
    fs.writeFileSync(path.join(planDir, "card_end.txt"), brand || main, "utf8");
    // drawtext has no wrapping: the size adapts so the longest line stays
    // inside ~88% of the frame width (DejaVu Bold averages ~0.58em per char).
    const big = Math.min(
      Math.round(Math.min(R.w, R.h) * 0.07),
      Math.floor((R.w * 0.88) / Math.max(8, main.length) / 0.58)
    );
    const small = Math.round(big * 0.45);
    const lead = 3.5, tail = 4.5;
    const common = [
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-an",
    ];
    // Cast-art open: when the render built a cast sheet, the title card plays
    // over the heroes themselves — blurred and dimmed so the type still reads —
    // like a real feature's one-sheet. Indigo card otherwise.
    const sheet = fs.existsSync(path.join(planDir, "castsheet.png"));
    const open = await run(
      "ffmpeg",
      ["-y",
       ...(sheet
         ? ["-loop", "1", "-t", String(lead), "-i", "castsheet.png"]
         : ["-f", "lavfi", "-t", String(lead), "-i", `color=c=0x15112a:s=${R.w}x${R.h}:r=30`]),
       "-vf",
       (sheet
         ? `scale=${R.w}:${R.h}:force_original_aspect_ratio=increase,crop=${R.w}:${R.h},boxblur=8,eq=brightness=-0.25:saturation=0.85,`
         : "") +
       `drawtext=fontfile=${FONT}:textfile=card_brand.txt:fontsize=${small}:fontcolor=0xf2b63c:x=(w-text_w)/2:y=h*0.30,` +
       `drawtext=fontfile=${FONT}:textfile=card_main.txt:fontsize=${big}:fontcolor=0xf3ebdc:x=(w-text_w)/2:y=(h-text_h)/2,` +
       `fade=t=in:d=0.5,fade=t=out:st=${(lead - 0.5).toFixed(1)}:d=0.5,setsar=1`,
       ...common, "card_open.mp4"],
      planDir
    );
    const end = await run(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-t", String(tail), "-i", `color=c=0x15112a:s=${R.w}x${R.h}:r=30`,
       "-vf",
       `drawtext=fontfile=${FONT}:text='Follow the light.':fontsize=${big}:fontcolor=0xf2b63c:x=(w-text_w)/2:y=(h-text_h)/2,` +
       `drawtext=fontfile=${FONT}:textfile=card_end.txt:fontsize=${small}:fontcolor=0xf3ebdc:x=(w-text_w)/2:y=h*0.62,` +
       `fade=t=in:d=0.5,fade=t=out:st=${(tail - 1).toFixed(1)}:d=1,setsar=1`,
       ...common, "card_end.mp4"],
      planDir
    );
    if (open.code !== 0 || end.code !== 0) return null;
    return { openCard: "card_open.mp4", endCard: "card_end.mp4", lead, tail };
  } catch {
    return null;
  }
}

export async function spliceFilm(planDir: string, plan: FilmPlan, outAbs: string): Promise<void> {
  const files = [
    ...(plan.openCard ? [plan.openCard] : []),
    ...plan.beats.map((b) => `seg_${b.i}.mp4`),
    ...(plan.endCard ? [plan.endCard] : []),
  ];
  fs.writeFileSync(path.join(planDir, "list.txt"), files.map((f) => `file '${f}'`).join("\n"), "utf8");
  const cat = await run(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "silent.mp4"],
    planDir
  );
  if (cat.code !== 0) throw new Error(`splice concat failed: ${cat.err.slice(-200)}`);

  const lead = plan.lead ?? 0;
  const tail = plan.tail ?? 0;
  const total = lead + plan.duration + tail;
  const music = plan.music && fs.existsSync(path.join(planDir, plan.music)) ? plan.music : null;
  const ambience =
    plan.ambience && fs.existsSync(path.join(planDir, plan.ambience)) ? plan.ambience : null;

  const args = ["-y", "-i", "silent.mp4", "-i", plan.voiceFile,
    "-f", "lavfi", "-t", String(total),
    "-i", "anoisesrc=colour=brown:sample_rate=44100,lowpass=f=300"];
  let fc: string;
  if (music) {
    // Voice delayed past the title card; the score ducks under it via
    // sidechain compression and carries the cards and the end credits alone.
    // The ambience layer (fireside crackle, wind, waves) sits even lower —
    // felt more than heard, under both the voice and the score.
    args.push("-i", music);
    let ambPart = "";
    const mixIns = ["[voB]", "[bed]", "[md]"];
    // The ambience ducks under the voice too (gentler than the score's duck),
    // so beds breathe between lines instead of hissing under close dialogue.
    const voSplit = ambience ? 3 : 2;
    const voC = ambience ? "[voC]" : "";
    if (ambience) {
      args.push("-i", ambience);
      ambPart = `[4:a]volume=0.14,apad[amA];[amA][voC]sidechaincompress=threshold=0.02:ratio=4:attack=120:release=1000[am];`;
      mixIns.push("[am]");
    }
    fc =
      `[1:a]adelay=${Math.round(lead * 1000)}:all=1,apad[vo];[vo]asplit=${voSplit}[voA][voB]${voC};` +
      `[3:a]volume=0.32,apad[mu];[mu][voA]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=900[md];` +
      `[2:a]volume=0.03[bed];` +
      ambPart +
      `${mixIns.join("")}amix=inputs=${mixIns.length}:duration=longest:normalize=0,atrim=0:${total.toFixed(3)},` +
      `loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
  } else if (lead > 0 || tail > 0) {
    let ambPart = "";
    let voSplitPart = "";
    const mixIns = [ambience ? "[voB]" : "[vo]", "[bed]"];
    if (ambience) {
      args.push("-i", ambience);
      voSplitPart = `[vo]asplit=2[voB][voC];`;
      ambPart = `[3:a]volume=0.14,apad[amA];[amA][voC]sidechaincompress=threshold=0.02:ratio=4:attack=120:release=1000[am];`;
      mixIns.push("[am]");
    }
    fc =
      `[1:a]adelay=${Math.round(lead * 1000)}:all=1,apad[vo];` +
      voSplitPart +
      `[2:a]volume=0.05[bed];` +
      ambPart +
      `${mixIns.join("")}amix=inputs=${mixIns.length}:duration=longest:normalize=0,atrim=0:${total.toFixed(3)},` +
      `loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
  } else {
    fc = "[2:a]volume=0.05[bed];[1:a][bed]amix=inputs=2:duration=first[mix];[mix]loudnorm=I=-14:TP=-1.5:LRA=11[a]";
  }
  const mux = await run(
    "ffmpeg",
    [...args, "-filter_complex", fc,
     "-map", "0:v", "-map", "[a]", ...(music || lead || tail ? [] : ["-shortest"]),
     "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outAbs],
    planDir
  );
  if (mux.code !== 0 || !fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
    throw new Error(`splice mux failed: ${mux.err.slice(-200)}`);
  }
}

/** Where a clip's persisted edit plan lives. */
export function planDirFor(clipId: string): string {
  return path.join(RENDERS_DIR, `plan-${clipId}`);
}

/**
 * Delete one scene from a film: cut its window out of the voice track (length
 * snapped to whole frames, so every later segment's frame count is unchanged
 * and nothing needs re-encoding), shift the remaining beats and word timings,
 * and drop the beat. The caller re-splices afterwards. Returns false when the
 * cut can't be made safely.
 */
export async function deleteFilmBeat(planDir: string, plan: FilmPlan, index: number): Promise<boolean> {
  const pos = plan.beats.findIndex((x) => x.i === index);
  if (pos < 0 || plan.beats.length <= 3) return false;
  const b = plan.beats[pos];
  const isLast = pos === plan.beats.length - 1;
  // Frame-aligned cut keeps all later segments' cumulative frame counts exact.
  const cutLen = isLast ? plan.duration - b.start : Math.round(b.dur * 30) / 30;
  const S = b.start;
  const E = b.start + cutLen;

  // Cut [S, E) out of the voice track, in place.
  const src = plan.voiceFile;
  const tmp = `voice_cut_tmp${src.endsWith(".wav") ? ".wav" : ".mp3"}`;
  const codec = src.endsWith(".wav") ? ["-c:a", "pcm_s16le"] : ["-c:a", "libmp3lame", "-q:a", "2"];
  const fc =
    pos === 0
      ? `[0:a]atrim=${E.toFixed(4)},asetpts=PTS-STARTPTS[a]`
      : isLast
        ? `[0:a]atrim=0:${S.toFixed(4)},asetpts=PTS-STARTPTS[a]`
        : `[0:a]atrim=0:${S.toFixed(4)},asetpts=PTS-STARTPTS[a1];[0:a]atrim=${E.toFixed(4)},asetpts=PTS-STARTPTS[a2];[a1][a2]concat=n=2:v=0:a=1[a]`;
  const res = await run("ffmpeg", ["-y", "-i", src, "-filter_complex", fc, "-map", "[a]", ...codec, tmp], planDir);
  if (res.code !== 0 || !fs.existsSync(path.join(planDir, tmp))) return false;
  fs.renameSync(path.join(planDir, tmp), path.join(planDir, src));

  // Shift the timeline past the cut; drop the beat and its segment.
  plan.words = plan.words
    .filter((w) => (w.s + w.e) / 2 < S || (w.s + w.e) / 2 >= E)
    .map((w) => ((w.s + w.e) / 2 >= E ? { ...w, s: w.s - cutLen, e: w.e - cutLen } : w));
  for (const nb of plan.beats) if (nb.start > b.start) nb.start -= cutLen;
  plan.duration = Math.max(0, plan.duration - cutLen);
  plan.beats.splice(pos, 1);
  fs.rmSync(path.join(planDir, `seg_${b.i}.mp4`), { force: true });
  return true;
}

/**
 * Scene-editor preview for a video beat (anim/broll) with no source still:
 * one frame extracted from the clip, cached as prev<i>.jpg in the plan dir.
 */
export async function extractBeatPreview(planDir: string, b: FilmBeat): Promise<string | null> {
  const name = `prev${b.i}.jpg`;
  const abs = path.join(planDir, name);
  if (fs.existsSync(abs)) return name;
  if (!fs.existsSync(path.join(planDir, b.file))) return null;
  const res = await run(
    "ffmpeg",
    ["-y", "-ss", "0.5", "-i", b.file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", name],
    planDir
  );
  return res.code === 0 && fs.existsSync(abs) ? name : null;
}

// Pause between spoken dialogue lines — reads as a natural beat, not a cut.
const LINE_GAP = 0.3;

async function renderScriptVideo(clip: Clip & { userEmail: string }): Promise<void> {
  if (!clip.script?.trim()) throw new Error("script text is missing");

  const { synthesizeSpeech } = await import("./tts");
  const { getCustomVoiceId, getPersona } = await import("./db");
  const { parseScreenplay, castVoices, isFrameLine } = await import("./dialogue");

  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const jobDir = path.join(RENDERS_DIR, `tmp-${clip.id}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const outAbs = path.join(RENDERS_DIR, `${clip.id}.mp4`);
  const defaultVoice = getCustomVoiceId(clip.userEmail);

  // Multi-voice path: speaker-tagged scripts synthesize per line, each
  // speaker in their own voice, stitched with natural gaps. Caption timing
  // actually improves here — every line's duration is measured, not guessed.
  const dialogue = parseScreenplay(clip.script);
  let voiceFile = "voice.mp3";
  let duration: number;
  let words: TranscriptWord[];
  let dialogueBeats: { text: string; dur: number; frame?: boolean; speak?: string; song?: boolean }[] | null = null;

  try {
    if (dialogue) {
      const castProps: {
        name: string;
        voice: string | null;
        charname?: string | null;
        meta?: string | null;
        portrait?: string;
      }[] = [];
      if (clip.props) {
        try {
          const { personaImagePath } = await import("./db");
          for (const pid of JSON.parse(clip.props) as string[]) {
            const p = getPersona(clip.userEmail, pid);
            if (p && (p.ptype === "character" || p.ptype === "presenter")) {
              const img = personaImagePath(p.id);
              castProps.push({
                name: p.name,
                voice: p.voice,
                charname: p.charname,
                meta: p.meta,
                ...(fs.existsSync(img) ? { portrait: img } : {}),
              });
            }
          }
        } catch {
          /* no cast — pool voices still keep speakers distinct */
        }
      }
      const voices = castVoices(dialogue, castProps);
      // Speaking close-ups (premium tier): the longest cast lines become
      // lip-synced close-up beats — the premium model animates the character's
      // portrait speaking the line in their own xAI voice (verified live), and
      // the clip's OWN speech audio becomes that line's voice-track slot, so
      // picture and sound can't drift. Capped at 6 per film for cost.
      const speakSet = new Map<number, { portrait: string; meta: string }>();
      if (clip.animate === 3 && (clip.lang || "en") === "en") {
        const { isXaiVoice } = await import("./dialogue");
        const cands: { i: number; len: number; portrait: string; meta: string }[] = [];
        for (let i = 0; i < dialogue.length; i++) {
          const line = dialogue[i];
          if (!isFrameLine(line)) continue;
          const v = voices.get(line.speaker);
          if (!v || !isXaiVoice(v)) continue;
          // Keep comfortable headroom under the model's 15s cap — a line that
          // needs ~13s got its last sentence truncated once; ≤10s estimated
          // speech plus the +2.5s budget below always fits.
          const est = line.text.length / 15;
          if (est < 4 || est > 10 || line.text.length > 150) continue;
          const sp = line.speaker.toLowerCase();
          const prop = castProps.find((p) => p.charname && p.charname.trim().toLowerCase() === sp);
          if (!prop?.portrait) continue;
          cands.push({ i, len: line.text.length, portrait: prop.portrait, meta: prop.meta ?? "" });
        }
        cands.sort((a, b) => b.len - a.len);
        for (const c of cands.slice(0, 6)) speakSet.set(c.i, { portrait: c.portrait, meta: c.meta });
      }
      const spIndex = new Map<string, number>();
      const segs: {
        file: string;
        dur: number;
        line: (typeof dialogue)[number];
        sp?: number;
        speak?: string;
        song?: boolean;
        gap?: number;
      }[] = [];
      for (let i = 0; i < dialogue.length; i++) {
        const line = dialogue[i];
        const v = voices.get(line.speaker);
        const f = `line${i}.mp3`;
        let speakVid: string | undefined;
        const spk = speakSet.get(i);
        if (spk && v) {
          try {
            const { generateSpeakClip } = await import("./video-gen");
            // Landscape films blur-pad the FULL portrait onto a 16:9 canvas —
            // cropping a band used to slice off the shoulders, and the model
            // then animated the truncated anatomy literally (head sitting at
            // torso level). With the whole figure visible, anatomy stays right.
            let srcAbs = spk.portrait;
            if (clip.orient === "landscape") {
              const pad = await run(
                "ffmpeg",
                ["-y", "-i", spk.portrait, "-filter_complex",
                 "[0:v]scale=1920:1080,boxblur=24[bg];[0:v]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0",
                 `speaksrc${i}.png`],
                jobDir
              );
              if (pad.code === 0) srcAbs = path.join(jobDir, `speaksrc${i}.png`);
            }
            const res = await generateSpeakClip({
              email: clip.userEmail,
              startImagePath: srcAbs,
              prompt: `Hand-painted 2D storybook cartoon, intimate close-up by warm lamplight: ${spk.meta || "the character"} looks toward the camera and says, exactly, word for word: "${line.text}". A well-composed close-up framed from the chest up — head naturally on the shoulders, correct proportions. Natural mouth movement matching the words, gentle living expression, small head motion. Keep the character design exactly as in the start image; no text on screen.`,
              voiceId: v,
              durationSec: Math.min(15, line.text.length / 15 + 2.5),
            });
            if (res) {
              const vd = `speakvid${i}.mp4`;
              fs.copyFileSync(res.file, path.join(jobDir, vd));
              const ex = await run(
                "ffmpeg",
                ["-y", "-i", vd, "-vn", "-acodec", "libmp3lame", "-q:a", "3", f],
                jobDir
              );
              const ad = ex.code === 0 ? await probeDuration(path.join(jobDir, f)) : null;
              if (ad && ad > 1) speakVid = vd;
            }
          } catch {
            /* any failure — the line falls back to plain TTS below */
          }
        }
        if (!speakVid) {
          const tts = await synthesizeSpeech(line.text, clip.lang || "en", v ?? defaultVoice);
          if (!tts) {
            throw new Error(
              "no voiceover provider — connect an ElevenLabs, xAI, or OpenAI key in the Operator Console"
            );
          }
          fs.writeFileSync(path.join(jobDir, f), tts.bytes);
        }
        const d = (await probeDuration(path.join(jobDir, f))) ?? Math.max(1, line.text.length / 15);
        let sp: number | undefined;
        if (v !== null && v !== undefined) {
          if (!spIndex.has(line.speaker)) spIndex.set(line.speaker, spIndex.size);
          sp = spIndex.get(line.speaker);
        }
        segs.push({ file: f, dur: d, line, sp, ...(speakVid ? { speak: speakVid } : {}) });
      }
      // Song runs: four or more consecutive short cast lines trading back and
      // forth read as sung verses — their captions render as sing-along
      // karaoke, and their words carry the k flag through alignment.
      {
        const isSongLine = (s: (typeof segs)[number]) =>
          isFrameLine(s.line) && s.line.text.length < 100;
        let runStart = 0;
        for (let i = 0; i <= segs.length; i++) {
          if (i < segs.length && isSongLine(segs[i])) continue;
          const run = segs.slice(runStart, i);
          if (run.length >= 4 && new Set(run.map((s) => s.line.speaker)).size >= 2) {
            for (const s of run) s.song = true;
          }
          runStart = i + 1;
        }
      }
      // Comic and interactive timing: a flat 0.3s gap between every line reads
      // robotic. Call-and-response lines hold 2.5s so kids can actually shout
      // the answer; punchy cast exclamations get a 0.7s beat for the laugh to
      // land. Song lines keep the tight musical gap.
      const INTERACT_RE =
        /say it (out loud|with me)|i'?ll wait|we'?ll wait|shout it|got it\?|do you have (it|them) in your mind/i;
      for (const s of segs) {
        s.gap = INTERACT_RE.test(s.line.text)
          ? 2.5
          : !s.song && isFrameLine(s.line) && /[!?]["']?$/.test(s.line.text.trim())
            ? 0.7
            : LINE_GAP;
      }
      // Stitch: pad each line with its gap, concat, decode to WAV once.
      const inputs = segs.flatMap((s) => ["-i", s.file]);
      const fc =
        segs.map((s, i) => `[${i}:a]apad=pad_dur=${(s.gap ?? LINE_GAP).toFixed(2)}[p${i}]`).join(";") +
        `;${segs.map((_, i) => `[p${i}]`).join("")}concat=n=${segs.length}:v=0:a=1[a]`;
      const cres = await run(
        "ffmpeg",
        ["-y", ...inputs, "-filter_complex", fc, "-map", "[a]", "-c:a", "pcm_s16le", "voice.wav"],
        jobDir
      );
      if (cres.code !== 0) throw new Error(`dialogue stitch failed: ${cres.err.slice(-200)}`);
      voiceFile = "voice.wav";
      duration = (await probeDuration(path.join(jobDir, "voice.wav"))) ?? 0;
      if (!duration) throw new Error("could not read the narration's duration");
      // Word timings + beats from MEASURED line durations. Beats are split
      // along the frame/story boundary: lines spoken by the recurring cast
      // (the storyteller and listeners) cut to a fireside FRAME shot, while
      // narrator and guest-voice lines cut to STORY illustrations — the two
      // worlds never share a scene. Story narration also cuts to a fresh
      // illustration sooner (5s vs 8s), so the tale gets most of the pictures.
      words = [];
      let t = 0;
      const beatsAcc: { text: string; dur: number; frame?: boolean; speak?: string; song?: boolean }[] = [];
      let acc = { text: "", dur: 0, frame: false, song: false };
      const flush = () => {
        if (acc.dur <= 0) return;
        const prev = beatsAcc[beatsAcc.length - 1];
        // Sub-2s slivers would be all fade — merge them into the neighbor,
        // but never into a speaking close-up (its visual is its own clip).
        if (prev && !prev.speak && acc.dur < 2) {
          prev.dur += acc.dur;
          prev.text += ` ${acc.text.trim()}`;
        } else {
          beatsAcc.push({
            text: acc.text.trim(),
            dur: acc.dur,
            frame: acc.frame,
            ...(acc.song ? { song: true } : {}),
          });
        }
        acc = { text: "", dur: 0, frame: acc.frame, song: acc.song };
      };
      for (const s of segs) {
        const gap = s.gap ?? LINE_GAP;
        for (const w of estimateWords(s.line.text, s.dur)) {
          words.push({
            ...w,
            s: w.s + t,
            e: w.e + t,
            ...(s.sp !== undefined ? { sp: s.sp } : {}),
            ...(s.song ? { k: 1 } : {}),
          });
        }
        t += s.dur + gap;
        // A speaking close-up is always its own beat: one line, one clip.
        if (s.speak) {
          flush();
          beatsAcc.push({ text: s.line.text, dur: s.dur + gap, frame: true, speak: s.speak });
          acc = { text: "", dur: 0, frame: true, song: false };
          continue;
        }
        const frame = isFrameLine(s.line);
        const song = s.song === true;
        // A song starting or ending is a visual boundary too — the sing-along
        // beat gets its own illustration window.
        if (acc.dur > 0 && (frame !== acc.frame || song !== acc.song)) flush();
        acc.frame = frame;
        acc.song = song;
        acc.text += ` ${s.line.text}`;
        acc.dur += s.dur + gap;
        if (acc.dur >= (frame ? 8 : 5)) flush();
      }
      if (acc.dur > 0) {
        const prev = beatsAcc[beatsAcc.length - 1];
        if (prev && !prev.speak && acc.dur < 3 && prev.frame === acc.frame) {
          prev.dur += acc.dur;
          prev.text += ` ${acc.text.trim()}`;
        } else flush();
      }
      dialogueBeats = beatsAcc;
      // Forced alignment: true word timings from the stitched narration,
      // with each word re-assigned its line's speaker for the caption tints.
      const aligned = await alignNarration(jobDir, voiceFile);
      if (aligned && aligned.length >= words.length * 0.5) {
        const windows: { s: number; e: number; sp?: number; k?: number }[] = [];
        let wt = 0;
        for (const seg of segs) {
          const gap = seg.gap ?? LINE_GAP;
          windows.push({ s: wt, e: wt + seg.dur + gap, sp: seg.sp, ...(seg.song ? { k: 1 } : {}) });
          wt += seg.dur + gap;
        }
        words = aligned.map((w) => {
          const mid = (w.s + w.e) / 2;
          const win = windows.find((x) => mid >= x.s && mid < x.e);
          if (!win) return w;
          return {
            ...w,
            ...(win.sp !== undefined ? { sp: win.sp } : {}),
            ...(win.k ? { k: 1 } : {}),
          };
        });
      }
    } else {
      const tts = await synthesizeSpeech(clip.script, clip.lang || "en", defaultVoice);
      if (!tts) {
        throw new Error(
          "no voiceover provider — connect an ElevenLabs, xAI, or OpenAI key in the Operator Console"
        );
      }
      const voicePath = path.join(jobDir, "voice.mp3");
      fs.writeFileSync(voicePath, tts.bytes);
      duration = (await probeDuration(voicePath)) ?? 0;
      if (!duration) throw new Error("could not read the narration's duration");
      words = estimateWords(clip.script, duration);
      const aligned = await alignNarration(jobDir, "voice.mp3");
      if (aligned && aligned.length >= words.length * 0.5) words = aligned;
    }

    let ass = buildAss(
      words,
      0,
      duration,
      clip.style as CaptionStyle,
      clip.position as CaptionPosition
    );
    if (needsWatermark(clip.userEmail)) {
      ass = withWatermark(ass, { w: 1080, h: 1920 }, duration);
    }
    fs.writeFileSync(path.join(jobDir, "subs.ass"), ass, "utf8");

    // Documentary mode: an art-director pass classifies each beat — data
    // becomes drawn stat cards and bar charts, enumerations become bullet
    // cards, the rest gets styled AI imagery with varied motion. Any failure
    // falls back to the waveform canvas.
    const beats = dialogueBeats ?? splitBeats(clip.script, duration);
    // Motion-picture orientation: landscape features render 1920x1080 through
    // the segmented path (stills, b-roll and animation all pass the same
    // scale/crop, so any source aspect lands correctly on the wide canvas).
    const wide = clip.orient === "landscape";
    const images: string[] = [];
    const kinds: string[] = [];
    // The exact prompt behind each generated beat image — re-roll fuel for the
    // scene editor; empty where the visual wasn't prompt-generated.
    const beatPrompts: string[] = [];
    // Stock providers used — credited in the publish description per their
    // API terms (Pixabay asks that the source be shown).
    const brollProviders = new Set<string>();
    // Whether any beat carries AI-generated motion — disclosed in the publish
    // description, same honesty rule as stock credits.
    let animUsed = false;
    // UGC spokesperson mode: every beat is the SAME presenter frame (persona
    // image), animated with speaking-style motion. No scene planning, no
    // cards, no b-roll — one person talking to camera, captions on top.
    let ugcUsed = false;
    if (clip.vstyle === "ugc" && clip.personaId) {
      try {
        const { personaImagePath } = await import("./db");
        const personaAbs = personaImagePath(clip.personaId);
        if (fs.existsSync(personaAbs) && beats.length >= 1) {
          for (let i = 0; i < beats.length; i++) {
            const name = `beat${i}.png`;
            fs.copyFileSync(personaAbs, path.join(jobDir, name));
            images.push(name);
            kinds.push("image");
            beatPrompts.push("");
          }
          ugcUsed = true;
          if (clip.animate) {
            const { animateStill, ANIM_MODELS, animSecondsLeft } = await import("./video-gen");
            const { getVideoStyle } = await import("./scenes");
            const { bestPlanFor } = await import("./db");
            const motion = getVideoStyle("ugc")!.motionPrompt("");
            let left = animSecondsLeft(bestPlanFor(clip.userEmail), clip.userEmail);
            const jobs: Promise<void>[] = [];
            for (let i = 0; i < beats.length && jobs.length < 8; i++) {
              const want = Math.min(15, Math.max(1, Math.ceil(beats[i].dur)));
              if (want > left) continue;
              left -= want;
              const idx = i;
              jobs.push(
                animateStill({
                  email: clip.userEmail,
                  pngPath: path.join(jobDir, images[idx]),
                  motion,
                  durationSec: beats[idx].dur,
                  model: ANIM_MODELS.lite,
                })
                  .then((res) => {
                    if (!res) return;
                    const vname = `anim${idx}.mp4`;
                    fs.copyFileSync(res.file, path.join(jobDir, vname));
                    images[idx] = vname;
                    kinds[idx] = "anim";
                    animUsed = true;
                  })
                  .catch(() => {})
              );
            }
            await Promise.all(jobs);
          }
        }
      } catch {
        images.length = 0;
        kinds.length = 0;
      }
    }
    if (images.length === 0 && beats.length >= 3) {
      try {
        const {
          planScenes,
          renderSceneStill,
          imagePromptFor,
          fetchBrollVideo,
          getVideoStyle,
          constrainScenes,
          castSheetFor,
          storyCastFor,
        } = await import("./scenes");
        const { generateBackground } = await import("./images");
        // Visual style preset (Animation Studio): bakes art direction + motion
        // language per beat; null = the documentary default.
        const styleDef = getVideoStyle(clip.vstyle);
        // Props library: user-supplied characters/products/settings/style refs
        // steer every scene through their vision-derived descriptions.
        let propCast: string | null = null;
        let propExtra = "";
        // Cast portrait files — reference_images for pixel-level character
        // continuity on premium-motion renders (verified live on video-1.5).
        const castRefs: string[] = [];
        // Archival props: the user's own photos, used AS the visuals (Ken
        // Burns treatment, pixels never AI-altered — authenticity is their
        // whole value), woven between generated scenes.
        const archival: string[] = [];
        if (clip.props) {
          try {
            const { getPersona, personaImagePath } = await import("./db");
            const ids = JSON.parse(clip.props) as string[];
            const chars: string[] = [];
            for (const pid of ids.slice(0, 4)) {
              const p = getPersona(clip.userEmail, pid);
              if (!p) continue;
              if (p.ptype === "archival") {
                const f = personaImagePath(p.id);
                if (fs.existsSync(f)) archival.push(f);
                continue;
              }
              if (!p.meta) continue;
              if (p.ptype === "character" || p.ptype === "presenter") {
                chars.push(p.meta);
                const img = personaImagePath(p.id);
                if (fs.existsSync(img)) castRefs.push(img);
              }
              else if (p.ptype === "product")
                propExtra += ` Feature this exact product prominently in the scene: ${p.meta}.`;
              else if (p.ptype === "setting") propExtra += ` The scene takes place in: ${p.meta}.`;
              else if (p.ptype === "style") propExtra += ` Match this visual style exactly: ${p.meta}.`;
            }
            if (chars.length) propCast = chars.join(" — and a second character: ");
          } catch {
            /* malformed props — render without them */
          }
        }
        // Pixel identity anchor: one cast-sheet image per render. Frame-beat
        // stills are composed by EDITING it (img2img), so the recurring cast's
        // faces match their portraits pixel-to-pixel in every scene instead of
        // being reinvented from a text description each time.
        let castSheetPng: Buffer | null = null;
        if (castRefs.length) {
          try {
            const n = Math.min(4, castRefs.length);
            const inputs = castRefs.slice(0, n).flatMap((p) => ["-i", p]);
            const fcc =
              n > 1
                ? castRefs.slice(0, n).map((_, j) => `[${j}:v]scale=-2:1024[s${j}]`).join(";") +
                  `;${castRefs.slice(0, n).map((_, j) => `[s${j}]`).join("")}hstack=${n}[v]`
                : "[0:v]scale=-2:1024[v]";
            const rc = await run(
              "ffmpeg",
              ["-y", ...inputs, "-filter_complex", fcc, "-map", "[v]", "-frames:v", "1", "castsheet.png"],
              jobDir
            );
            if (rc.code === 0) castSheetPng = fs.readFileSync(path.join(jobDir, "castsheet.png"));
          } catch {
            /* no sheet — frame beats fall back to text-described cast */
          }
        }
        let archIdx = 0;
        let imageBeatNo = 0;
        // Character consistency, OpenArt-style: user-picked cast wins; else a
        // generated cast sheet for styles that want one — but never for a
        // dialogue script with no character props: a narrated special (the
        // Creation film) must not grow an invented recurring character, and
        // its scenes should track the narration alone.
        const cast =
          propCast ??
          (styleDef?.castSheet && !dialogueBeats
            ? await castSheetFor(clip.title, clip.script).catch(() => null)
            : null);
        // Story cast sheet (dialogue scripts with the frame/story split): the
        // tale's own recurring characters, designed once for every story
        // illustration — the frame cast never enters the tale, and the tale's
        // hero keeps one face across the whole film.
        const storyCast = dialogueBeats
          ? await storyCastFor(clip.title, clip.script).catch(() => null)
          : null;
        // Documentary (no style preset) still honors a recurring character.
        if (!styleDef && propCast) {
          propExtra += ` Recurring character, EXACT same design in every scene: ${propCast}.`;
        }
        let scenes = await planScenes(beats, clip.title);
        if (styleDef) scenes = constrainScenes(scenes, styleDef);
        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          // Speaking close-ups arrive pre-rendered from the voice pass with
          // their speech already in the voice track — the clip IS the visual.
          const speakVid = dialogueBeats ? (beats[i] as { speak?: string }).speak : undefined;
          if (speakVid && fs.existsSync(path.join(jobDir, speakVid))) {
            images.push(speakVid);
            kinds.push("speak");
            beatPrompts.push("");
            animUsed = true;
            continue;
          }
          // Real stock footage where the narration calls for it (needs a
          // stock key); misses fall through to AI imagery below.
          if (scene.kind === "broll" && scene.brollQuery) {
            const vid = await fetchBrollVideo(jobDir, `beat${i}.mp4`, scene.brollQuery);
            if (vid) {
              images.push(vid.file);
              kinds.push("broll");
              beatPrompts.push("");
              brollProviders.add(vid.provider);
              continue;
            }
          }
          const name = `beat${i}.png`;
          // Data/text scenes render locally (drawtext); anything that can't
          // becomes imagery, so one bad slide never kills the whole style.
          if (scene.kind !== "image" && scene.kind !== "broll") {
            const drawn = await renderSceneStill(jobDir, name, scene);
            if (drawn) {
              images.push(drawn);
              kinds.push(scene.kind);
              beatPrompts.push("");
              continue;
            }
          }
          // Weave archival photos into every other imagery beat; they keep the
          // Ken Burns move but are excluded from AI animation (kind "arch").
          if (archival.length && imageBeatNo++ % 2 === 1) {
            fs.copyFileSync(archival[archIdx++ % archival.length], path.join(jobDir, name));
            images.push(name);
            kinds.push("arch");
            beatPrompts.push("");
            continue;
          }
          // Frame/story split (dialogue scripts): fireside FRAME beats carry
          // the recurring cast around the lamp; STORY beats illustrate the
          // narration's world alone — the cast never crowds the tale, and the
          // setting/product props belong to the story, not the fireside.
          const beatFrame = dialogueBeats ? (beats[i] as { frame?: boolean }).frame === true : null;
          const beatSubject =
            beatFrame === true
              ? `the storytelling frame between story scenes: the recurring cast gathered close around a glowing clay oil lamp in a cozy night-time home, the elderly storyteller mid-tale with warm gestures and a gentle, kind, tender face — never stern — the young listeners' lamplit faces reacting to this moment: ${scene.text.slice(0, 110)}`
              : scene.imageSubject
                ? // Anchor the picture to the words being spoken over it, not
                  // just the planner's abstraction — illustration follows text.
                  `${scene.imageSubject} — faithfully illustrating exactly this narration moment: "${scene.text.slice(0, 130)}"`
                : scene.text.slice(0, 120);
          const beatCast = beatFrame === false ? (storyCast ?? undefined) : (cast ?? undefined);
          // Story beats: the recurring cast may ONLY appear when the narration
          // names them — the Ep9 audit found the hero leaking into scenes he
          // couldn't be in (ashore watching his own ship, among the sailors
          // after going overboard). Also a brand-safety rail: divine presence
          // is light, never a drawn figure.
          const storyGuard =
            beatFrame === false
              ? " Include a recurring character ONLY if this exact narration moment explicitly mentions them — if it does not name them, leave them out of the image entirely. Never depict God as a person or human figure: when the narration has God speak, act or answer, show His presence ONLY as warm light from the sky."
              : "";
          const beatExtra = (beatFrame === true ? "" : propExtra) + storyGuard;
          let beatPrompt =
            (styleDef
              ? styleDef.imagePrompt(
                  beatSubject,
                  i,
                  beatCast,
                  scenes.length > 1 ? i / (scenes.length - 1) : 0
                )
              : imagePromptFor(beatSubject, i)) + beatExtra;
          if (wide) {
            beatPrompt = beatPrompt.replace(
              /Vertical 9:16 composition/g,
              "Widescreen 16:9 cinematic composition"
            );
          }
          // Frame beats with a cast sheet render as img2img edits of it — the
          // cast's identity comes from pixels, not prose.
          const anchored = beatFrame === true && castSheetPng !== null;
          const genOnce = async (): Promise<Buffer | null> => {
            if (anchored) {
              const { editImage } = await import("./images");
              const out = await editImage(
                castSheetPng!,
                `${beatPrompt} Compose this as a NEW scene using EXACTLY the characters from the reference image — same faces, same outfits, same designs. Include only the characters this moment calls for, in a natural composition — never the reference's side-by-side lineup. FULL-BLEED cinematic frame filling the entire image edge to edge — NOT a storybook page, no page borders, no margins, no caption area, and ABSOLUTELY NO text, letters, or words anywhere; if any text or page layout would appear, replace it with plain scenery instead.`
              );
              if (out) return out;
            }
            return generateBackground(beatPrompt);
          };
          // A provider hiccup must not demote a whole feature to the waveform
          // fallback (it did once, after a heavy generation burst): retry each
          // beat with backoff, then reuse the previous beat's art as a
          // stand-in — the scene editor can re-roll that one scene later.
          // Only a failure on the very first visual aborts the plan.
          let bg = await genOnce();
          for (const wait of [4000, 15000]) {
            if (bg) break;
            await new Promise((r) => setTimeout(r, wait));
            bg = await genOnce();
          }
          const prev = images[images.length - 1];
          if (bg) {
            fs.writeFileSync(path.join(jobDir, name), bg);
          } else if (prev && prev.endsWith(".png")) {
            fs.copyFileSync(path.join(jobDir, prev), path.join(jobDir, name));
          } else {
            images.length = 0;
            break;
          }
          images.push(name);
          kinds.push("image");
          beatPrompts.push(beatPrompt);
        }

        // AI motion: animate the AI-imagery beats into moving shots when the
        // creator asked for it and their monthly allowance covers it.
        // Strictly additive — any failure keeps the zoompan still, and the
        // generations run in parallel (each is a remote render).
        if (clip.animate && images.length === beats.length) {
          const { animateStill, ANIM_MODELS, animSecondsLeft } = await import("./video-gen");
          const { bestPlanFor } = await import("./db");
          let left = animSecondsLeft(bestPlanFor(clip.userEmail), clip.userEmail);
          // Full motion (animate>=2): EVERY AI-imagery scene becomes a moving
          // shot — the motion-picture mode. Standard (animate=1) keeps the
          // original cap of 8 animated highlights. Premium continuity
          // (animate=3): fireside frame beats upgrade to the premium model
          // with the cast portraits as reference images, so the recurring
          // characters match pixel-for-pixel across scenes.
          const maxJobs = clip.animate >= 2 ? scenes.length : 8;
          const tasks: (() => Promise<void>)[] = [];
          // One dolly-zoom per premium film: the single most dramatic reveal
          // gets the Vertigo treatment on the premium model.
          let dollyUsed = false;
          for (let i = 0; i < scenes.length && tasks.length < maxJobs; i++) {
            if (kinds[i] !== "image") continue;
            const want = Math.min(15, Math.max(1, Math.ceil(beats[i].dur)));
            if (want > left) continue;
            left -= want;
            const idx = i;
            const subject = scenes[idx].imageSubject ?? scenes[idx].text.slice(0, 120);
            const premiumRef =
              clip.animate === 3 &&
              castRefs.length > 0 &&
              (dialogueBeats ? (beats[idx] as { frame?: boolean }).frame === true : false);
            const dolly =
              !dollyUsed &&
              clip.animate === 3 &&
              /\b(giant|towered|towering|loomed|enormous|vast|mighty|wall of)\b/i.test(beats[idx].text);
            if (dolly) dollyUsed = true;
            tasks.push(() =>
              animateStill({
                email: clip.userEmail,
                pngPath: path.join(jobDir, images[idx]),
                motion: dolly
                  ? `A dramatic dolly zoom on ${subject}: the camera slowly pulls back while the lens zooms in, the background stretching and receding behind the unmoving subject — a feeling of awe and unease. One move only. Keep the exact art style, characters, lighting and framing; add no new elements, no text.`
                  : styleDef
                    ? styleDef.motionPrompt(subject)
                    : `One camera move only: a slow, gentle drift across ${subject}, with soft natural ambient movement. Keep the scene's content, lighting and framing unchanged; add no new objects, no people, no text.`,
                durationSec: beats[idx].dur,
                model: dolly || premiumRef ? ANIM_MODELS.premium : ANIM_MODELS.lite,
                ...(premiumRef ? { refPaths: castRefs } : {}),
              })
                .then((res) => {
                  if (!res) return;
                  const name = `anim${idx}.mp4`;
                  fs.copyFileSync(res.file, path.join(jobDir, name));
                  images[idx] = name;
                  kinds[idx] = "anim";
                  animUsed = true;
                })
                .catch(() => {})
            );
          }
          // Waves of 5 keep a feature's 80+ generations from stampeding the
          // provider; a standard run's ≤8 jobs finish in two waves.
          for (let w = 0; w < tasks.length; w += 5) {
            await Promise.all(tasks.slice(w, w + 5).map((f) => f()));
          }
        }
      } catch {
        images.length = 0;
      }
    }

    if (images.length && images.length === beats.length) {
      // Segmented assembly: one small segment per beat (veryfast encodes sum
      // to a fraction of one monolithic medium encode), stream-copy concat,
      // audio muxed once with the room-tone bed and broadcast loudness. The
      // plan + sources + segments persist so single scenes can be re-edited
      // and spliced in seconds.
      let t0 = 0;
      const planBeats: FilmBeat[] = beats.map((b, i) => {
        const d = Math.max(1, b.dur);
        const fb: FilmBeat = {
          i,
          text: b.text,
          start: t0,
          dur: d,
          kind: kinds[i],
          file: images[i],
          prompt: beatPrompts[i] ?? "",
          ...((b as { frame?: boolean }).frame === true ? { frame: true } : {}),
          ...((b as { song?: boolean }).song === true ? { song: true } : {}),
        };
        t0 += d;
        return fb;
      });
      const plan: FilmPlan = {
        style: clip.style,
        position: clip.position,
        watermark: needsWatermark(clip.userEmail),
        look: clip.vstyle === "cinematic",
        voiceFile,
        duration: t0,
        words,
        beats: planBeats,
        lang: clip.lang || "en",
        ...(wide ? { wide: true } : {}),
        cuts: "straight",
        camera: "v2",
      };
      // Studio dressing, both best-effort: branded title/end cards around the
      // film, and the mood-mapped score mixed (and ducked) under the voice.
      const cards = await makeFilmCards(jobDir, plan, clip.title).catch(() => null);
      if (cards) Object.assign(plan, cards);
      const { buildScore, buildAmbience } = await import("./music");
      const score = await buildScore(jobDir, planBeats, t0, plan.lead ?? 0, plan.tail ?? 0).catch(() => null);
      if (score) plan.music = score;
      // SFX/ambience layer: synthesized soundscapes (fireside crackle under
      // the frame, wind on journeys, waves at sea) windowed over the film.
      const amb = await buildAmbience(jobDir, planBeats, t0, plan.lead ?? 0, plan.tail ?? 0).catch(() => null);
      if (amb) plan.ambience = amb;
      for (const b of planBeats) {
        await renderBeatSegment(jobDir, plan, b);
      }
      await spliceFilm(jobDir, plan, outAbs);
      fs.writeFileSync(path.join(jobDir, "plan.json"), JSON.stringify(plan), "utf8");
      // Closed-caption sidecar: the real word timings (shifted past the title
      // card) as SRT — the scheduler uploads it to YouTube after publishing.
      try {
        fs.writeFileSync(
          path.join(jobDir, "captions.srt"),
          srtFromWords(words, plan.lead ?? 0),
          "utf8"
        );
      } catch {
        /* captions sidecar is a bonus */
      }
      // Persist the working dir as the clip's edit plan (replacing any older one).
      const planDir = planDirFor(clip.id);
      fs.rmSync(planDir, { recursive: true, force: true });
      fs.renameSync(jobDir, planDir);
      const { setClipRenderMeta } = await import("./db");
      setClipRenderMeta(clip.userEmail, clip.id, { hasPlan: true });
      // Study notes (pedagogy layer): scripture references + the historical,
      // geographical and cultural facts the script itself teaches, compiled
      // into the clip's description text — it rides into YouTube on publish.
      // Facts only from the script; best-effort, never blocks the render.
      try {
        const { llmComplete } = await import("./generate");
        const res = await llmComplete(
          "From this children's Bible screenplay, extract study notes for a YouTube description. Return JSON: scripture = the passage(s) the script retells or quotes (e.g. 'Luke 10:25-37'); facts = 2 to 4 one-sentence historical, geographical, cultural or religious-context facts THAT THE SCRIPT ITSELF STATES (e.g. what a denarius was worth, why Samaritans and Jews were estranged, the geography of a road). Never invent facts the script doesn't contain.",
          clip.script.slice(0, 7000),
          {
            type: "object",
            properties: {
              scripture: { type: "string" },
              facts: { type: "array", items: { type: "string" } },
            },
            required: ["scripture", "facts"],
            additionalProperties: false,
          },
          { tier: "standard", maxTokens: 400, context: "study-notes" }
        );
        if (res?.text) {
          const n = JSON.parse(res.text) as { scripture: string; facts: string[] };
          if (n.scripture) {
            const notes = [
              `📖 Scripture: ${n.scripture}`,
              ...n.facts.slice(0, 4).map((f) => `• ${f}`),
            ].join("\n");
            // Mutate in memory: the final updateClip composes reason from
            // clip.reason + disclosures, so the notes ride along in order.
            clip.reason = clip.reason?.trim() ? `${clip.reason.trim()}\n\n${notes}` : notes;
          }
        }
      } catch {
        /* study notes are a bonus — never fail a finished film over them */
      }
      // YouTube chapters, computed from the plan's real timeline and appended
      // to the description — YouTube parses "M:SS Title" lines into a chapter
      // bar, which doubles as a parent's map of the episode.
      try {
        const lead = plan.lead ?? 0;
        const fmt = (s: number) =>
          `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
        const marks: { t: number; label: string }[] = [{ t: 0, label: "Opening" }];
        if (lead > 0) marks.push({ t: lead, label: "By the lamplight" });
        const firstStory = planBeats.find((b) => b.frame !== true);
        if (firstStory) marks.push({ t: lead + firstStory.start, label: "The story begins" });
        let inSong = false;
        let verseDone = false;
        for (const b of planBeats) {
          if (b.song && !inSong) marks.push({ t: lead + b.start, label: "Sing along" });
          inSong = b.song === true;
          if (!verseDone && /lamp down low/i.test(b.text)) {
            marks.push({ t: lead + b.start, label: "The memory verse" });
            verseDone = true;
          }
        }
        marks.push({ t: lead + t0, label: "Goodnight" });
        marks.sort((a, b) => a.t - b.t);
        // YouTube needs chapters at least 10s apart — spacing measured against
        // the last KEPT mark, so one crowded label never knocks out the rest.
        const kept: typeof marks = [];
        for (const m of marks) {
          if (!kept.length || m.t - kept[kept.length - 1].t >= 10) kept.push(m);
        }
        if (kept.length >= 3) {
          const block = `Chapters:\n${kept.map((m) => `${fmt(m.t)} ${m.label}`).join("\n")}`;
          clip.reason = clip.reason?.trim() ? `${clip.reason.trim()}\n\n${block}` : block;
        }
      } catch {
        /* chapters are a bonus too */
      }
    } else {
      const args = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x140a24:s=1080x1920:r=30",
        "-i",
        voiceFile,
        "-filter_complex",
        "[1:a]showwaves=s=1080x220:mode=cline:rate=30:colors=0xa855f7|0x3b82f6[w];[0:v][w]overlay=0:1520[bg];[bg]ass=subs.ass[v]",
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outAbs,
      ];
      const res = await run("ffmpeg", args, jobDir);
      if (res.code !== 0) {
        throw new Error(
          res.err.includes("ENOENT")
            ? "ffmpeg is not installed on this server"
            : `ffmpeg exited ${res.code}: ${res.err.slice(-300)}`
        );
      }
    }
    if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
      throw new Error("render produced no output");
    }
    updateClip(clip.userEmail, clip.id, {
      status: "ready",
      outputPath: path.relative(process.cwd(), outAbs),
      error: null,
      // Source credit + AI-motion disclosure ride the reason field into the
      // publish description — Pixabay's API terms ask that the footage source
      // be shown, and generated motion is disclosed as a matter of honesty.
      ...(brollProviders.size || animUsed || ugcUsed || clip.reason?.trim()
        ? {
            reason:
              `${clip.reason ?? ""}`.trim() +
              `${clip.reason?.trim() ? "\n\n" : ""}` +
              [
                brollProviders.size ? `Stock footage: ${[...brollProviders].join(", ")}.` : "",
                ugcUsed ? "The presenter in this video is AI-generated and AI-animated." : "",
                !ugcUsed && animUsed ? "Some scenes feature AI-generated motion (xAI Imagine)." : "",
              ]
                .filter(Boolean)
                .join(" "),
          }
        : {}),
    });
    insertNotification(clip.userEmail, {
      id: `n-${crypto.randomUUID()}`,
      title: "Script Video Ready",
      message: `"${clip.title}" is narrated${dialogue ? ` (${new Set(dialogue.map((l) => l.speaker)).size} voices)` : ""}, captioned, and rendered — preview, download, or schedule it from the Clips tab.`,
      time: "Just now",
      read: false,
      type: "success",
    });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/** Soundscape beds synthesized from ffmpeg's noise source — the same audio
 *  family real sleep channels use. Deterministic, license-free, key-free. */
export const AMBIENT_SOUNDSCAPES = [
  "ocean",
  "brown-noise",
  "rain",
  "wind",
  "thunder",
  "waterfall",
  "binaural",
  "purr",
] as const;

/** Freesound search phrases for the scapes that exist as real recordings.
 *  Synthetic-by-nature scapes (noise colors, binaural, purr) are absent. */
const AMBIENT_REAL_QUERIES: Record<string, string> = {
  ocean: "ocean waves shore loop",
  rain: "steady rain ambience loop",
  thunder: "rain distant thunder ambience",
  waterfall: "waterfall ambience",
  wind: "wind trees ambience",
};

const SOUNDSCAPE_BASE: Record<string, string> = {
    // NB tremolo's minimum frequency is 0.1 Hz — slower "wave" cycles are
    // rejected with a range error (verified on the prod ffmpeg).
    // Water texture: droplet "plinks" come from VELVET noise (sparse random
    // impulses; density is per-sample, so ~0.0001 ≈ a few events/sec) rung
    // through a resonant bandpass and splashed with aecho. Verified sparse on
    // prod (≈29 dB mean-to-peak gap). Ocean adds a foam-hiss layer swelling
    // with the waves.
    ocean:
      "anoisesrc=colour=brown:sample_rate=44100,lowpass=f=600,tremolo=f=0.1:d=0.8,volume=0.55[o];anoisesrc=colour=white:sample_rate=44100,highpass=f=2500,tremolo=f=0.1:d=0.7,volume=0.05[f];[o][f]amix=inputs=2:duration=longest,volume=1.3",
    "brown-noise": "anoisesrc=colour=brown:sample_rate=44100,lowpass=f=500,volume=0.5",
    rain: "anoisesrc=colour=pink:sample_rate=44100,highpass=f=300,lowpass=f=7000,volume=0.24[r];anoisesrc=colour=velvet:sample_rate=44100:seed=11:density=0.00012,bandpass=f=2400:width_type=q:w=7,aecho=0.6:0.4:45|85:0.3|0.18,volume=5[d];[r][d]amix=inputs=2:duration=longest,volume=1.4",
    wind: "anoisesrc=colour=pink:sample_rate=44100,lowpass=f=900,tremolo=f=0.1:d=0.55,volume=0.4",
    // The four below are original synthesis INSPIRED BY the categories
    // myNoise.net users love most (their audio is proprietary — these share
    // a recipe idea, not a sample). Thunder = steady rain over irregular far
    // rumbles (two incommensurate tremolos beat against each other so the
    // envelope never audibly repeats, and no sharp claps — the design note
    // behind every good sleep-thunder scape).
    thunder:
      "anoisesrc=colour=pink:sample_rate=44100,highpass=f=300,lowpass=f=7000,volume=0.22[rn];anoisesrc=colour=brown:sample_rate=44100:seed=7,lowpass=f=110,tremolo=f=0.1:d=0.9,tremolo=f=0.13:d=0.75,volume=0.5[th];[rn][th]amix=inputs=2:duration=longest,volume=1.4",
    waterfall:
      "anoisesrc=colour=white:sample_rate=44100,highpass=f=120,lowpass=f=7500,volume=0.17[w];anoisesrc=colour=brown:sample_rate=44100,lowpass=f=400,volume=0.3[b];anoisesrc=colour=velvet:sample_rate=44100:seed=42:density=0.00008,bandpass=f=1600:width_type=q:w=8,aecho=0.7:0.5:70|130:0.4|0.25,volume=8[d];[w][b][d]amix=inputs=3:duration=longest,volume=1.6",
    // 200 Hz carrier, 206 Hz in the other ear → 6 Hz theta beat, over a
    // faint brown bed so headphones-off playback isn't a bare test tone.
    binaural:
      "sine=frequency=200:sample_rate=44100[L];sine=frequency=206:sample_rate=44100[R];[L][R]join=inputs=2:channel_layout=stereo,volume=0.22[t];anoisesrc=colour=brown:sample_rate=44100,lowpass=f=350,volume=0.12,aformat=channel_layouts=stereo[n];[t][n]amix=inputs=2:duration=longest",
    // ~2.3 Hz amplitude bursts on band-limited low noise ≈ a resting purr,
    // with a slow second modulation as the breathing cycle.
    purr: "anoisesrc=colour=brown:sample_rate=44100,lowpass=f=160,highpass=f=25,tremolo=f=2.3:d=0.85,tremolo=f=0.12:d=0.5,volume=0.6",
  };
function soundscapeGraph(kind: string, durationSec: number): string {
  const g = SOUNDSCAPE_BASE[kind] ?? SOUNDSCAPE_BASE.ocean;
  // Gentle entry and exit — nothing in a sleep video should startle.
  return `${g},afade=t=in:st=0:d=4,afade=t=out:st=${Math.max(0, durationSec - 6).toFixed(1)}:d=6`;
}

/**
 * Ambient loop: a single AI still with a glacial palindromic drift (zoom out
 * lands exactly where the zoom in began, so loop joins are seamless), encoded
 * once as a short base segment and stream-copy concatenated to the target
 * length — an hour of video for ~2 minutes of encoding — over a synthesized
 * soundscape. No captions, no cuts, no grain: the anti-documentary.
 */
async function renderAmbientLoop(clip: Clip & { userEmail: string }): Promise<void> {
  let cfg: { theme?: string; minutes?: number; soundscape?: string } = {};
  try {
    cfg = JSON.parse(clip.script ?? "{}");
  } catch {
    /* fall through to defaults */
  }
  const theme = String(cfg.theme ?? clip.title).slice(0, 140);
  const minutes = Math.max(5, Math.min(60, Math.round(Number(cfg.minutes) || 30)));
  const soundscape = String(cfg.soundscape ?? "ocean");

  const { generateBackground } = await import("./images");
  const bg = await generateBackground(
    `Soft-focus ambient night scene: ${theme}. Deep calm palette of midnight blue and muted violet, gentle gradients, dreamlike haze, very low contrast, serene and still, no people, absolutely no text or letters or words, no watermark. Wide cinematic 16:9 composition.`
  );
  if (!bg) {
    throw new Error("no image provider available — connect an image key in the Operator Console");
  }

  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const jobDir = path.join(RENDERS_DIR, `tmp-${clip.id}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const outAbs = path.join(RENDERS_DIR, `${clip.id}.mp4`);

  try {
    fs.writeFileSync(path.join(jobDir, "bg.png"), bg);

    // Pre-soften once (blur per output frame would be wasted work).
    let r = await run(
      "ffmpeg",
      [
        "-y", "-i", "bg.png",
        "-vf",
        "scale=4800:2700:force_original_aspect_ratio=increase,crop=4800:2700,gblur=sigma=2.2,eq=saturation=0.82:brightness=-0.03",
        "-frames:v", "1", "prep.png",
      ],
      jobDir
    );
    if (r.code !== 0) throw new Error(`ambient prep failed: ${r.err.slice(-200)}`);

    // Base segment: 150 s palindromic drift at 24 fps, video-only.
    const BASE_SEC = 150;
    const FPS = 24;
    const F = BASE_SEC * FPS;
    const half = F / 2;
    const AMP = 0.055;
    const z = `if(lte(on,${half}),1+${AMP}*on/${half},1+${AMP}*(${F}-on)/${half})`;
    r = await run(
      "ffmpeg",
      [
        "-y", "-loop", "1", "-i", "prep.png",
        "-vf",
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${F}:s=1920x1080:fps=${FPS},setsar=1`,
        "-frames:v", String(F),
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "27",
        "-pix_fmt", "yuv420p", "-an",
        "base.mp4",
      ],
      jobDir
    );
    if (r.code !== 0) throw new Error(`ambient base render failed: ${r.err.slice(-200)}`);

    // Loop by stream copy — length costs storage, not CPU.
    const loops = Math.max(1, Math.ceil((minutes * 60) / BASE_SEC));
    const totalSec = loops * BASE_SEC;
    fs.writeFileSync(path.join(jobDir, "list.txt"), Array(loops).fill("file 'base.mp4'").join("\n"));
    r = await run(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "long.mp4"],
      jobDir
    );
    if (r.code !== 0) throw new Error(`ambient concat failed: ${r.err.slice(-200)}`);

    // Audio bed. Preferred: a REAL CC0 field recording (Freesound), looped
    // for the runtime and layered over a quiet synth bed — the synth layer
    // masks the loop seams and fills the spectrum. Fallback: synth only,
    // continuous for the whole runtime.
    let bed: string | null = null;
    const realQuery = AMBIENT_REAL_QUERIES[soundscape];
    if (realQuery) {
      const { fetchFieldRecording } = await import("./scenes");
      bed = await fetchFieldRecording(jobDir, "bed.mp3", realQuery);
    }
    if (bed) {
      const fades = `afade=t=in:st=0:d=4,afade=t=out:st=${Math.max(0, totalSec - 6).toFixed(1)}:d=6`;
      r = await run(
        "ffmpeg",
        [
          "-y", "-i", "long.mp4",
          "-stream_loop", "-1", "-t", String(totalSec), "-i", bed,
          "-f", "lavfi", "-t", String(totalSec), "-i",
          SOUNDSCAPE_BASE[soundscape] ?? SOUNDSCAPE_BASE.ocean,
          "-filter_complex",
          `[1:a]volume=0.85[real];[2:a]volume=0.3[synth];[real][synth]amix=inputs=2:duration=first,${fades}[a]`,
          "-map", "0:v", "-map", "[a]",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
          "-shortest", "-movflags", "+faststart",
          outAbs,
        ],
        jobDir
      );
      // A bad recording must never fail the render — retry synth-only.
      if (r.code !== 0) bed = null;
    }
    if (!bed) {
      r = await run(
        "ffmpeg",
        [
          "-y", "-i", "long.mp4",
          "-f", "lavfi", "-t", String(totalSec), "-i", soundscapeGraph(soundscape, totalSec),
          "-map", "0:v", "-map", "1:a",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
          "-shortest", "-movflags", "+faststart",
          outAbs,
        ],
        jobDir
      );
    }
    if (r.code !== 0) throw new Error(`ambient mux failed: ${r.err.slice(-200)}`);
    if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
      throw new Error("render produced no output");
    }

    updateClip(clip.userEmail, clip.id, {
      status: "ready",
      outputPath: path.relative(process.cwd(), outAbs),
      error: null,
    });
    insertNotification(clip.userEmail, {
      id: `n-${crypto.randomUUID()}`,
      title: "Ambient Video Ready",
      message: `"${clip.title}" is rendered — ${Math.round(totalSec / 60)} minutes of seamless ${soundscape} ambience, ready to preview or download from the Clips tab.`,
      time: "Just now",
      read: false,
      type: "success",
    });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/** In-app caption-only job: the whole source video, captioned, uncut. */
async function renderCaptionFull(clip: Clip & { userEmail: string }): Promise<void> {
  const media = getProjectMedia(clip.userEmail, clip.projectId);
  if (!media?.storagePath) throw new Error("source video is no longer stored for this project");
  const srcAbs = path.join(process.cwd(), media.storagePath);
  if (!fs.existsSync(srcAbs)) throw new Error("source video file is missing on disk");

  const duration = media.durationSec ?? (await probeDuration(srcAbs));
  const words =
    media.words ??
    (media.transcript && duration ? estimateWords(media.transcript, duration) : []);
  if (!words.length) {
    throw new Error("no transcript for captions — connect a transcription key and re-upload");
  }

  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const outAbs = path.join(RENDERS_DIR, `${clip.id}.mp4`);
  const r = await renderCaptionOnly(
    srcAbs,
    words,
    clip.style as CaptionStyle,
    clip.position as CaptionPosition,
    outAbs,
    { watermark: needsWatermark(clip.userEmail) }
  );
  if (!r.ok) throw new Error(r.error);

  updateClip(clip.userEmail, clip.id, {
    status: "ready",
    outputPath: path.relative(process.cwd(), outAbs),
    error: null,
  });
  insertNotification(clip.userEmail, {
    id: `n-${crypto.randomUUID()}`,
    title: "Captioned Video Ready",
    message: `"${clip.title}" is captioned end-to-end — download or schedule it from the Clips tab.`,
    time: "Just now",
    read: false,
    type: "success",
  });
}

/** Split a script into visual beats, durations proportional to text length. */
function splitBeats(script: string, duration: number): { text: string; dur: number }[] {
  const sents = script
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const n = Math.max(3, Math.min(8, Math.round(duration / 7)));
  if (sents.length < n) return [];
  const perBeat = Math.ceil(sents.length / n);
  const beats: { text: string; dur: number }[] = [];
  for (let i = 0; i < sents.length; i += perBeat) {
    beats.push({ text: sents.slice(i, i + perBeat).join(" "), dur: 0 });
  }
  const totalChars = beats.reduce((a, b) => a + b.text.length, 0) || 1;
  let allocated = 0;
  beats.forEach((b, i) => {
    b.dur =
      i === beats.length - 1
        ? Math.max(1, duration - allocated)
        : Math.max(2, (b.text.length / totalChars) * duration);
    allocated += b.dur;
  });
  return beats;
}

declare global {
  // One render at a time, surviving dev-mode module reloads.
  var __virafoldRenderBusy: boolean | undefined;
  // Last low-disk admin alert, so the guard warns at most every 6 hours.
  var __virafoldDiskAlertAt: number | undefined;
}

/**
 * Default thumbnail: the video's own first full picture, grabbed ~1.5s in
 * (frame zero is mid-fade). Shown as the card poster and set on YouTube at
 * publish unless the creator picked a Lab/A-B thumbnail.
 */
export async function extractThumb(clip: Clip & { userEmail: string }): Promise<void> {
  const { getClip, setClipRenderMeta } = await import("./db");
  const fresh = getClip(clip.userEmail, clip.id);
  if (!fresh?.outputPath || fresh.status !== "ready") return;
  const abs = path.join(process.cwd(), fresh.outputPath);
  const dur = await probeDuration(abs);
  if (!dur) return;
  // Skip past the title card so the default thumb is the film's first scene.
  let lead = 0;
  try {
    const p = JSON.parse(fs.readFileSync(path.join(planDirFor(clip.id), "plan.json"), "utf8")) as FilmPlan;
    lead = p.lead ?? 0;
  } catch {
    /* no plan — monolith render */
  }
  const t = Math.min(lead + 1.5, dur / 2);
  const thumbAbs = path.join(RENDERS_DIR, `${clip.id}-thumb.jpg`);
  const res = await run(
    "ffmpeg",
    ["-y", "-ss", t.toFixed(2), "-i", abs, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", thumbAbs],
    RENDERS_DIR
  );
  if (res.code === 0 && fs.existsSync(thumbAbs)) {
    setClipRenderMeta(clip.userEmail, clip.id, { thumbPath: path.relative(process.cwd(), thumbAbs) });
  }
}

const QA_RUBRIC = [
  "You are QA-checking frames sampled from an AI-generated vertical video.",
  "Look ONLY for real defects: garbled or nonsensical text, mangled faces, hands, or anatomy, blank or corrupted frames, severe rendering artifacts.",
  "Stylistic quirks, soft focus, film grain, and bold colors are NOT defects.",
  'Return JSON: {"ok": true|false, "issues": ["<specific defect and which frame>"]} — ok must be true unless a clear defect exists.',
].join("\n");

/**
 * Vision QA gate: sample three frames from a finished render and have the
 * vision model look for genuine defects. Failures flag the clip (Review
 * Inbox + notification) — they never unpublish or delete anything, because
 * the model is a reviewer here, not a judge.
 */
async function qaRender(clip: Clip & { userEmail: string }): Promise<void> {
  const { getClip, setClipQa } = await import("./db");
  const fresh = getClip(clip.userEmail, clip.id);
  if (!fresh || fresh.status !== "ready" || !fresh.outputPath) return;
  const abs = path.join(process.cwd(), fresh.outputPath);
  const dur = await probeDuration(abs);
  if (!dur) return;
  const qaDir = path.join(RENDERS_DIR, `tmp-qa-${clip.id}`);
  fs.mkdirSync(qaDir, { recursive: true });
  try {
    const frames: Buffer[] = [];
    for (const frac of [0.2, 0.5, 0.8]) {
      const f = path.join(qaDir, `f${frac}.png`);
      const res = await run(
        "ffmpeg",
        ["-y", "-ss", (dur * frac).toFixed(2), "-i", abs, "-frames:v", "1", "-vf", "scale=540:-2", f],
        qaDir
      );
      if (res.code === 0 && fs.existsSync(f)) frames.push(fs.readFileSync(f));
    }
    if (frames.length < 2) return;
    const { visionJson } = await import("./images");
    const verdict = await visionJson(frames, QA_RUBRIC);
    if (!verdict || verdict.ok !== false) return; // pass, or no verdict — never flag on silence
    const issues = Array.isArray(verdict.issues)
      ? verdict.issues.map(String).join("; ").slice(0, 300)
      : "possible visual defect";
    if (!issues) return;
    setClipQa(clip.userEmail, clip.id, issues);
    insertNotification(clip.userEmail, {
      id: `n-${crypto.randomUUID()}`,
      title: "Render Quality Check",
      message: `"${clip.title}" rendered, but the automatic quality check flagged: ${issues}. Preview it in Clips — re-render if it looks off, or ignore the flag if it looks fine.`,
      time: "Just now",
      read: false,
      type: "warning",
    });
  } catch {
    /* QA is best-effort — never block the queue */
  } finally {
    fs.rmSync(qaDir, { recursive: true, force: true });
  }
}

/** Drain the render queue sequentially. Safe to call from anywhere, any time —
 *  returns immediately if a render is already in flight. */
export function kickRenderWorker(): void {
  if (globalThis.__virafoldRenderBusy) return;
  globalThis.__virafoldRenderBusy = true;
  (async () => {
    try {
      for (;;) {
        // Disk guard: a render onto a full disk produces a truncated mp4 that
        // ffmpeg may not even flag. Leave the queue intact (jobs retry next
        // tick once space returns) and alert admins instead of failing jobs.
        try {
          const { freeDiskBytes } = await import("./ops-digest");
          const free = freeDiskBytes(RENDERS_DIR);
          if (free !== null && free < 1024 ** 3) {
            const now = Date.now();
            if (now - (globalThis.__virafoldDiskAlertAt ?? 0) > 6 * 3600_000) {
              globalThis.__virafoldDiskAlertAt = now;
              for (const admin of (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)) {
                insertNotification(admin, {
                  id: `n-${crypto.randomUUID()}`,
                  title: "Renders paused — disk almost full",
                  message: `Under 1 GB free on the render volume. Queued renders are held (not failed) and will resume automatically once space is freed.`,
                  time: "Just now",
                  read: false,
                  type: "warning",
                });
              }
            }
            break;
          }
        } catch {
          /* guard is best-effort — never block rendering on it */
        }
        const next = listQueuedClips()[0];
        if (!next) break;
        updateClip(next.userEmail, next.id, { status: "rendering" });
        try {
          if (next.kind === "script") await renderScriptVideo(next);
          else if (next.kind === "caption") await renderCaptionFull(next);
          else if (next.kind === "ambient") await renderAmbientLoop(next);
          else await renderOne(next);
          // Every finished render gets its first-picture default thumbnail.
          await extractThumb(next).catch(() => {});
          // Production-grade gate: every finished short render gets a vision
          // QA pass (ambient loops skip it — hour-long static drift).
          if (next.kind !== "ambient") await qaRender(next).catch(() => {});
        } catch (e) {
          const msg = String(e instanceof Error ? e.message : e);
          // ffmpeg killed by a service restart (deploys) exits 255/137 — that
          // is not the clip's fault. Requeue once instead of failing it.
          if (/exited (255|137)/.test(msg) && !next.error?.includes("[restart-retry]")) {
            updateClip(next.userEmail, next.id, {
              status: "queued",
              error: "[restart-retry]",
            });
            continue;
          }
          updateClip(next.userEmail, next.id, {
            status: "failed",
            error: msg.slice(0, 300),
          });
          insertNotification(next.userEmail, {
            id: `n-${crypto.randomUUID()}`,
            title: "Clip Render Failed",
            message: `"${next.title}" could not be rendered: ${String(
              e instanceof Error ? e.message : e
            ).slice(0, 160)}`,
            time: "Just now",
            read: false,
            type: "warning",
          });
        }
      }
    } finally {
      globalThis.__virafoldRenderBusy = false;
    }
  })();
}

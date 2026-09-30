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
  const [align, marginV] =
    position === "top"
      ? [8, Math.round(140 * k)]
      : position === "middle"
        ? [5, 0]
        : [2, Math.round(base.bottomMarginV * k)];
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

  const events: string[] = [];
  let chunk: TranscriptWord[] = [];
  const flush = () => {
    if (!chunk.length) return;
    const start = Math.max(0, chunk[0].s - clipStart);
    const end = Math.min(clipEnd - clipStart, chunk[chunk.length - 1].e - clipStart);
    if (end > start) {
      let text = assEscape(chunk.map((w) => w.w).join(" "));
      if (cfg.upper) text = text.toUpperCase();
      if (text) {
        events.push(`Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Default,,0,0,0,,${text}`);
      }
    }
    chunk = [];
  };
  for (const w of inRange) {
    // A speaker change (diarized interviews) always starts a fresh caption.
    if (chunk.length && w.sp !== undefined && w.sp !== chunk[chunk.length - 1].sp) flush();
    chunk.push(w);
    const dur = chunk[chunk.length - 1].e - chunk[0].s;
    if (chunk.length >= cfg.wordsPerChunk || dur >= 2.2) flush();
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
const TIGHT_GAP = 0.35;
const TIGHT_PAD = 0.1;

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
    // Tight cut (default on): drop dead air >0.35s inside the clip window —
    // the retention tactic from the Mathis Bolt playbook. Captions are
    // re-timed onto the compressed timeline so they stay in sync.
    const segs = clip.tight !== 0 ? tightSegments(words, clip.startSec, clip.endSec) : null;
    let effWords = words;
    let effDur = Math.max(1, clip.endSec - clip.startSec);
    if (segs) {
      effDur = Math.max(1, segs.reduce((s, r) => s + (r.b - r.a), 0));
      effWords = words
        .filter((w) => w.e > clip.startSec && w.s < clip.endSec)
        .map((w) => ({
          ...w,
          s: clip.startSec + compressTime(w.s, segs),
          e: clip.startSec + Math.max(compressTime(w.e, segs), compressTime(w.s, segs) + 0.05),
        }));
    }

    let ass = buildAss(
      effWords,
      clip.startSec,
      clip.startSec + effDur,
      clip.style as CaptionStyle,
      clip.position as CaptionPosition
    );
    if (needsWatermark(clip.userEmail)) {
      ass = withWatermark(ass, { w: 1080, h: 1920 }, effDur);
    }
    fs.writeFileSync(path.join(jobDir, "subs.ass"), ass, "utf8");

    // Crop focus: where the subject sits in the source frame — left, center,
    // or right slice of the 9:16 cut (the pragmatic talking-head fix until
    // true face tracking).
    const cropX =
      clip.focus === "left" ? "0" : clip.focus === "right" ? "iw-ow" : "(iw-ow)/2";
    let vf = `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':${cropX}:'(ih-oh)/2',scale=1080:1920`;
    const args = ["-y", "-ss", String(clip.startSec), "-i", srcAbs, "-t",
      String(Math.max(1, clip.endSec - clip.startSec))];
    if (segs) {
      // -ss before -i resets timestamps, so select() sees window-relative t.
      const expr = segs
        .map((r) => `between(t,${(r.a - clip.startSec).toFixed(3)},${(r.b - clip.startSec).toFixed(3)})`)
        .join("+");
      vf += `,select='${expr}',setpts=N/FRAME_RATE/TB`;
      args.push("-af", `aselect='${expr}',asetpts=N/SR/TB`);
    }
    vf += ",ass=subs.ass";
    args.push(
      "-vf", vf,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outAbs
    );
    const res = await run("ffmpeg", args, jobDir);
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
async function renderScriptVideo(clip: Clip & { userEmail: string }): Promise<void> {
  if (!clip.script?.trim()) throw new Error("script text is missing");

  const { synthesizeSpeech } = await import("./tts");
  const { getCustomVoiceId } = await import("./db");
  const tts = await synthesizeSpeech(clip.script, "en", getCustomVoiceId(clip.userEmail));
  if (!tts) {
    throw new Error(
      "no voiceover provider — connect an ElevenLabs, xAI, or OpenAI key in the Operator Console"
    );
  }

  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const jobDir = path.join(RENDERS_DIR, `tmp-${clip.id}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const outAbs = path.join(RENDERS_DIR, `${clip.id}.mp4`);

  try {
    const voicePath = path.join(jobDir, "voice.mp3");
    fs.writeFileSync(voicePath, tts.bytes);
    const duration = await probeDuration(voicePath);
    if (!duration) throw new Error("could not read the narration's duration");

    const words = estimateWords(clip.script, duration);
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
    const beats = splitBeats(clip.script, duration);
    const images: string[] = [];
    const kinds: string[] = [];
    if (beats.length >= 3) {
      try {
        const { planScenes, renderSceneStill, imagePromptFor } = await import("./scenes");
        const { generateBackground } = await import("./images");
        const scenes = await planScenes(beats, clip.title);
        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          const name = `beat${i}.png`;
          // Data/text scenes render locally (drawtext); anything that can't
          // becomes imagery, so one bad slide never kills the whole style.
          if (scene.kind !== "image") {
            const drawn = await renderSceneStill(jobDir, name, scene);
            if (drawn) {
              images.push(drawn);
              kinds.push(scene.kind);
              continue;
            }
          }
          const bg = await generateBackground(
            imagePromptFor(scene.imageSubject ?? scene.text.slice(0, 120), i)
          );
          if (!bg) {
            images.length = 0;
            break;
          }
          fs.writeFileSync(path.join(jobDir, name), bg);
          images.push(name);
          kinds.push("image");
        }
      } catch {
        images.length = 0;
      }
    }

    let args: string[];
    if (images.length && images.length === beats.length) {
      // Slideshow: imagery gets alternating push-in/pull-back moves plus film
      // grain and a vignette; drawn cards stay static and crisp (zooming text
      // shimmers). A short fade-in on every segment masks the cuts.
      const inputs = images.flatMap((name) => ["-i", name]);
      const segs = images
        .map((_, i) => {
          const frames = Math.max(30, Math.round(beats[i].dur * 30));
          const base = `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
          if (kinds[i] === "image") {
            const zoom =
              i % 2 === 0
                ? `zoompan=z='min(zoom+0.0012,1.12)':d=${frames}:s=1080x1920:fps=30`
                : `zoompan=z='if(eq(on,1),1.12,max(zoom-0.0012,1.0))':d=${frames}:s=1080x1920:fps=30`;
            return `${base},${zoom},vignette=PI/5,noise=alls=5:allf=t,fade=t=in:st=0:d=0.35,setsar=1[v${i}]`;
          }
          return `${base},zoompan=z=1:d=${frames}:s=1080x1920:fps=30,fade=t=in:st=0:d=0.35,setsar=1[v${i}]`;
        })
        .join(";");
      const concatIn = images.map((_, i) => `[v${i}]`).join("");
      const fc = `${segs};${concatIn}concat=n=${images.length}:v=1:a=0[vc];[vc]ass=subs.ass[v]`;
      args = [
        "-y",
        ...inputs,
        "-i",
        "voice.mp3",
        "-filter_complex",
        fc,
        "-map",
        "[v]",
        "-map",
        `${images.length}:a`,
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
    } else {
      args = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x140a24:s=1080x1920:r=30",
        "-i",
        "voice.mp3",
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
    }
    const res = await run("ffmpeg", args, jobDir);
    if (res.code !== 0) {
      throw new Error(
        res.err.includes("ENOENT")
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
      title: "Script Video Ready",
      message: `"${clip.title}" is narrated (${tts.provider}), captioned, and rendered — preview, download, or schedule it from the Clips tab.`,
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

function soundscapeGraph(kind: string, durationSec: number): string {
  const base: Record<string, string> = {
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
  const g = base[kind] ?? base.ocean;
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

    // One continuous audio bed for the whole runtime (no loop seams).
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
}

/** Drain the render queue sequentially. Safe to call from anywhere, any time —
 *  returns immediately if a render is already in flight. */
export function kickRenderWorker(): void {
  if (globalThis.__virafoldRenderBusy) return;
  globalThis.__virafoldRenderBusy = true;
  (async () => {
    try {
      for (;;) {
        const next = listQueuedClips()[0];
        if (!next) break;
        updateClip(next.userEmail, next.id, { status: "rendering" });
        try {
          if (next.kind === "script") await renderScriptVideo(next);
          else if (next.kind === "caption") await renderCaptionFull(next);
          else if (next.kind === "ambient") await renderAmbientLoop(next);
          else await renderOne(next);
        } catch (e) {
          updateClip(next.userEmail, next.id, {
            status: "failed",
            error: String(e instanceof Error ? e.message : e).slice(0, 300),
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

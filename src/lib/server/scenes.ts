/**
 * Documentary scene planning for script-videos.
 *
 * Instead of one AI image + identical slow zoom per beat (the "AI feel"),
 * each narration beat is classified and rendered in the style that fits it:
 *   - stat  → a typographic big-number card (drawbox/drawtext, campaign-04 style)
 *   - chart → horizontal bars drawn from numbers IN the narration
 *   - list  → a titled bullet card
 *   - quote → a large pull-quote card
 *   - image → AI imagery with rotating documentary art direction
 *
 * Honesty is enforced mechanically: any number on a stat or chart card must
 * appear verbatim in that beat's narration, or the scene is downgraded to
 * imagery. The planner can suggest; it cannot invent.
 *
 * Slide rendering uses ffmpeg drawtext (Linux server only — segfaults on the
 * Windows dev ffmpeg; the whole render worker already runs server-side).
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { llmComplete } from "./generate";

export interface SceneBar {
  label: string;
  value: number;
}

export interface Scene {
  kind: "image" | "stat" | "chart" | "list" | "quote";
  text: string;
  dur: number;
  imageSubject?: string;
  stat?: { value: string; label: string };
  chart?: { title: string; bars: SceneBar[] };
  list?: { title: string; items: string[] };
  quote?: string;
}

const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const BG = "0x0b0714";
const PURPLE = "0xa855f7";
const BLUE = "0x3b82f6";
const WHITE = "0xf5f3ff";
const MUTED = "0x9d94b8";

/** Rotating art direction so consecutive image beats never look alike. */
const IMAGE_STYLES = [
  "documentary photograph, 35mm film still, natural window light, muted colors with a violet cast",
  "editorial magazine illustration, textured risograph print style, deep purple and electric blue inks",
  "archival photo aesthetic, high-contrast monochrome with a subtle purple duotone, film grain",
  "macro detail photograph, shallow depth of field, moody studio lighting, cool blue accents",
  "overhead documentary shot of a real workspace, cinematic haze, practical lights",
];

export function imagePromptFor(subject: string, index: number): string {
  const style = IMAGE_STYLES[index % IMAGE_STYLES.length];
  return `${style}; depicting ${subject}. Vertical 9:16 composition, realistic and grounded, absolutely no text or letters or words or logos, no watermark.`;
}

// --- Planning ---

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["image", "stat", "chart", "list", "quote"] },
          imageSubject: { type: "string" },
          statValue: { type: "string" },
          statLabel: { type: "string" },
          chartTitle: { type: "string" },
          chartBars: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, value: { type: "number" } },
              required: ["label", "value"],
            },
          },
          listTitle: { type: "string" },
          listItems: { type: "array", items: { type: "string" } },
          quote: { type: "string" },
        },
        required: ["kind"],
      },
    },
  },
  required: ["scenes"],
} as const;

/** Every digit-string on a data card must literally appear in the narration. */
function numbersAppearIn(text: string, candidates: string[]): boolean {
  const hay = text.replace(/,/g, "");
  return candidates.every((c) => {
    const nums = String(c).replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
    return nums.every((n) => hay.includes(n));
  });
}

function deterministicScene(beat: { text: string; dur: number }, i: number): Scene {
  const m = beat.text.match(/(\$?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|x|k|K|M)?)/);
  // A beat built around one clear number becomes a stat card; the label is
  // the sentence it lives in, trimmed.
  if (m && m[1].replace(/\D/g, "").length >= 2) {
    const sentence =
      beat.text.split(/(?<=[.!?])\s+/).find((s) => s.includes(m[1])) ?? beat.text;
    return {
      kind: "stat",
      text: beat.text,
      dur: beat.dur,
      stat: { value: m[1].trim(), label: sentence.trim().slice(0, 120) },
    };
  }
  return {
    kind: "image",
    text: beat.text,
    dur: beat.dur,
    imageSubject: beat.text.slice(0, 120),
  };
}

export async function planScenes(
  beats: { text: string; dur: number }[],
  title: string
): Promise<Scene[]> {
  const fallback = beats.map(deterministicScene);
  const res = await llmComplete(
    [
      "You are the art director of a short documentary. For each narration beat, choose the visual that makes it land:",
      "- stat: the beat centers on ONE number → statValue (the number exactly as spoken, e.g. \"87\" or \"$49\" or \"30+\") + statLabel (short phrase, max 8 words).",
      "- chart: the beat compares 2-4 numbers → chartTitle + chartBars [{label (max 3 words), value (number)}]. ONLY numbers spoken in the beat.",
      "- list: the beat enumerates 2-4 concrete steps/items → listTitle + listItems (max 5 words each).",
      "- quote: the beat is one punchy declarative line worth reading on screen → quote (the line, max 12 words, verbatim or lightly trimmed).",
      "- image: everything else → imageSubject: a concrete, filmable subject (max 12 words), literal not abstract — a person doing something, an object, a place. Never 'abstract concept of growth'.",
      "HARD RULE: every number you output must appear verbatim in that beat's narration. Never invent or round numbers.",
      "Return scenes in the same order and count as the beats. Vary the kinds — a run of three identical kinds is a failure unless the narration demands it.",
    ].join("\n"),
    `Video title: ${title}\n\nNarration beats:\n${beats
      .map((b, i) => `${i + 1}. ${b.text}`)
      .join("\n")}`,
    PLAN_SCHEMA as unknown as Record<string, unknown>,
    { tier: "standard", maxTokens: 1800, context: "scene-plan" }
  );
  if (!res) return fallback;

  try {
    const parsed = JSON.parse(res.text) as {
      scenes: {
        kind: string;
        imageSubject?: string;
        statValue?: string;
        statLabel?: string;
        chartTitle?: string;
        chartBars?: SceneBar[];
        listTitle?: string;
        listItems?: string[];
        quote?: string;
      }[];
    };
    if (!Array.isArray(parsed.scenes) || parsed.scenes.length !== beats.length) {
      return fallback;
    }
    return parsed.scenes.map((s, i) => {
      const base = { text: beats[i].text, dur: beats[i].dur };
      switch (s.kind) {
        case "stat":
          if (s.statValue && s.statLabel && numbersAppearIn(base.text, [s.statValue])) {
            return { kind: "stat", ...base, stat: { value: s.statValue, label: s.statLabel } };
          }
          break;
        case "chart": {
          const bars = (s.chartBars ?? []).slice(0, 4);
          if (
            s.chartTitle &&
            bars.length >= 2 &&
            numbersAppearIn(base.text, bars.map((b) => String(b.value)))
          ) {
            return { kind: "chart", ...base, chart: { title: s.chartTitle, bars } };
          }
          break;
        }
        case "list": {
          const items = (s.listItems ?? []).slice(0, 4);
          if (s.listTitle && items.length >= 2) {
            return { kind: "list", ...base, list: { title: s.listTitle, items } };
          }
          break;
        }
        case "quote":
          if (s.quote && s.quote.length <= 90) {
            return { kind: "quote", ...base, quote: s.quote };
          }
          break;
      }
      return {
        kind: "image",
        ...base,
        imageSubject: s.imageSubject?.slice(0, 120) || base.text.slice(0, 120),
      };
    });
  } catch {
    return fallback;
  }
}

// --- Slide rendering (drawtext/drawbox → PNG) ---

function esc(s: string): string {
  // NB: '%' must NOT be backslash-escaped — \% silently blanks the whole
  // drawtext (verified on the prod ffmpeg); a bare % renders literally.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/[:,;\[\]=]/g, (c) => `\\${c}`)
    .replace(/%\{/g, "% {") // %{...} is drawtext's expansion syntax
    .replace(/\r?\n/g, " ");
}

function wrap(s: string, width: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width && cur) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur.trim());
  if (lines.length === maxLines && cur && !lines.includes(cur)) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, "") + "…";
  }
  return lines;
}

function dt(
  text: string,
  opts: { size: number; y: number | string; color?: string; font?: string; x?: string; alpha?: number }
): string {
  return (
    `drawtext=fontfile=${opts.font ?? FONT_BOLD}:text='${esc(text)}'` +
    `:fontsize=${opts.size}:fontcolor=${opts.color ?? WHITE}` +
    (opts.alpha !== undefined ? `@${opts.alpha}` : "") +
    `:x=${opts.x ?? "(w-text_w)/2"}:y=${opts.y}`
  );
}

function box(x: number, y: number, w: number, h: number, color: string): string {
  return `drawbox=x=${x}:y=${y}:w=${Math.max(2, Math.round(w))}:h=${h}:color=${color}:t=fill`;
}

/** The shared slide chrome: accent rule top-left, faint frame. */
const CHROME = [box(90, 200, 210, 8, PURPLE), box(90, 214, 90, 8, BLUE)];

function statFilters(sc: Scene): string[] {
  const label = wrap(sc.stat!.label, 26, 3);
  return [
    ...CHROME,
    dt(sc.stat!.value, { size: sc.stat!.value.length > 5 ? 200 : 280, y: 640, color: WHITE }),
    box(390, 1010, 300, 6, PURPLE),
    ...label.map((l, i) => dt(l, { size: 56, y: 1090 + i * 80, color: MUTED, font: FONT_REG })),
  ];
}

function chartFilters(sc: Scene): string[] {
  const bars = sc.chart!.bars;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const title = wrap(sc.chart!.title, 24, 2);
  const f: string[] = [
    ...CHROME,
    ...title.map((l, i) => dt(l, { size: 72, y: 330 + i * 92 })),
  ];
  const top = 640;
  const rowH = 210;
  bars.forEach((b, i) => {
    const y = top + i * rowH;
    const w = 90 + (b.value / max) * 700;
    f.push(dt(b.label, { size: 46, y, x: "110", color: MUTED, font: FONT_REG }));
    f.push(box(110, y + 64, w, 84, i === 0 ? BLUE : PURPLE));
    f.push(dt(String(b.value), { size: 54, y: y + 76, x: `${Math.round(130 + w)}` }));
  });
  return f;
}

function listFilters(sc: Scene): string[] {
  const title = wrap(sc.list!.title, 24, 2);
  const f: string[] = [
    ...CHROME,
    ...title.map((l, i) => dt(l, { size: 76, y: 340 + i * 96 })),
  ];
  sc.list!.items.forEach((item, i) => {
    const y = 680 + i * 190;
    f.push(box(110, y + 14, 34, 34, i % 2 ? BLUE : PURPLE));
    for (const [j, l] of wrap(item, 30, 2).entries()) {
      f.push(dt(l, { size: 56, y: y + j * 68, x: "190", font: FONT_REG }));
    }
  });
  return f;
}

function quoteFilters(sc: Scene): string[] {
  const lines = wrap(sc.quote!, 20, 4);
  const startY = 960 - lines.length * 55;
  return [
    ...CHROME,
    dt('“', { size: 300, y: startY - 320, color: PURPLE }),
    ...lines.map((l, i) => dt(l, { size: 84, y: startY + i * 110 })),
  ];
}

function runFfmpeg(args: string[], cwd: string): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { cwd });
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", () => resolve({ code: -1, err: "ENOENT" }));
    child.on("close", (code) => resolve({ code: code ?? -1, err }));
  });
}

/** Draw a data/text scene to a PNG in jobDir. Null → caller falls back to imagery. */
export async function renderSceneStill(
  jobDir: string,
  name: string,
  scene: Scene
): Promise<string | null> {
  if (!fs.existsSync(FONT_BOLD)) return null; // Windows dev box, or fonts missing
  let filters: string[];
  switch (scene.kind) {
    case "stat":
      filters = statFilters(scene);
      break;
    case "chart":
      filters = chartFilters(scene);
      break;
    case "list":
      filters = listFilters(scene);
      break;
    case "quote":
      filters = quoteFilters(scene);
      break;
    default:
      return null;
  }
  // Soft vertical wash behind the type so slides aren't dead-flat.
  const vf = [
    box(0, 0, 1080, 1920, `${BG}@1`),
    `drawbox=x=0:y=1400:w=1080:h=520:color=${PURPLE}@0.07:t=fill`,
    ...filters,
  ].join(",");
  const res = await runFfmpeg(
    ["-y", "-f", "lavfi", "-i", `color=c=${BG}:s=1080x1920`, "-vf", vf, "-frames:v", "1", name],
    jobDir
  );
  const out = path.join(jobDir, name);
  if (res.code !== 0 || !fs.existsSync(out) || fs.statSync(out).size === 0) return null;
  return name;
}

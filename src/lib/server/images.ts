/**
 * AI image generation for thumbnails and cover art. Provider chain mirrors
 * the LLM one: xAI (grok-imagine-image-2.0) first, then OpenAI (dall-e-3).
 * The model paints a text-free background; ffmpeg overlays the title in the
 * brand's caption style, because image models still butcher typography.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveField } from "./integrations";

const RENDERS_DIR = path.join(process.cwd(), "data", "renders");

/**
 * Vision pass: describe an uploaded/generated prop image so its look can be
 * injected verbatim into scene prompts (prompt-level consistency — the same
 * trick as cast sheets, grounded in a real image). Best-effort: null on any
 * failure, and props still work as plain attachments.
 */
export async function describeImage(image: Buffer, instruction: string): Promise<string | null> {
  const xaiKey = resolveField("llm", "xaiApiKey");
  if (!xaiKey) return null;
  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.7",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${image.toString("base64")}` },
              },
            ],
          },
        ],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    return text.length > 10 ? text.slice(0, 400) : null;
  } catch {
    return null;
  }
}

/**
 * Image-to-image edit via Imagine's edits endpoint (recon-verified:
 * {prompt, image: {url}} → {data: [{url}]}). The source image is published at
 * a one-time token URL the API can fetch, then removed. Null on any failure —
 * callers fall back to fresh generation.
 */
export async function editImage(image: Buffer, prompt: string): Promise<Buffer | null> {
  const xaiKey = resolveField("llm", "xaiApiKey");
  if (!xaiKey) return null;
  const { FRAMES_DIR } = await import("./video-gen");
  const { publicOriginStatic } = await import("./base-url");
  const crypto = await import("node:crypto");
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const token = crypto.randomBytes(16).toString("hex");
  const framePath = path.join(FRAMES_DIR, `${token}.png`);
  fs.writeFileSync(framePath, image);
  try {
    const resp = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        image: { url: `${publicOriginStatic()}/api/frames/${token}` },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const url = data?.data?.[0]?.url;
    if (!url) return null;
    const dl = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!dl.ok) return null;
    const buf = Buffer.from(await dl.arrayBuffer());
    return buf.length > 5_000 ? buf : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(framePath, { force: true });
  }
}

export async function generateBackground(prompt: string): Promise<Buffer | null> {
  const xaiKey = resolveField("llm", "xaiApiKey");
  if (xaiKey) {
    try {
      const resp = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${xaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "grok-imagine-image-2.0", prompt, response_format: "b64_json" }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) return Buffer.from(b64, "base64");
      }
    } catch {
      /* fall through */
    }
  }

  const openaiKey = resolveField("llm", "openaiApiKey");
  if (openaiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          size: "1792x1024",
          response_format: "b64_json",
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) return Buffer.from(b64, "base64");
      }
    } catch {
      /* no provider */
    }
  }
  return null;
}

function run(args: string[], cwd: string): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    let err = "";
    let child;
    try {
      child = spawn("ffmpeg", args, { cwd, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, err: String(e) });
      return;
    }
    child.stderr?.on("data", (d) => {
      err += String(d);
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on("error", (e) => resolve({ code: -1, err: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? -1, err }));
  });
}

/** drawtext chokes on quotes/colons — keep the overlay title plain. */
function sanitizeTitle(title: string): string {
  return title.replace(/['":;\\%]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Generates a thumbnail: AI background + title text burned on via ffmpeg.
 * Returns the relative path of the finished 1280x720 PNG, or null.
 */
/**
 * Multi-image vision call returning parsed JSON — the engine behind render QA
 * and thumbnail scoring. Null on any failure; callers treat that as "no
 * verdict", never as a pass or a fail.
 */
export async function visionJson(
  images: Buffer[],
  instruction: string
): Promise<Record<string, unknown> | null> {
  const xaiKey = resolveField("llm", "xaiApiKey");
  if (!xaiKey || images.length === 0) return null;
  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.7",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              ...images.slice(0, 4).map((img) => ({
                type: "image_url",
                image_url: { url: `data:image/png;base64,${img.toString("base64")}` },
              })),
            ],
          },
        ],
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return JSON.parse(String(data?.choices?.[0]?.message?.content ?? "")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Thumbnail art directions, CTR-fundamentals first. `face` uses the persona
 *  description when one is attached — a consistent face IS the channel brand. */
export function thumbPrompts(topic: string, personaMeta?: string | null): string[] {
  return [
    personaMeta
      ? `Photorealistic YouTube thumbnail: ${personaMeta} — with an intense, exaggerated emotional expression (shock or excitement), face filling the left half of the frame, reacting to: ${topic}. Bold rim light, high contrast background, absolutely no text or letters or words, no watermark.`
      : `Photorealistic close-up video thumbnail about: ${topic}. One person with an intense, exaggerated emotional expression filling the left half of the frame, warm rim light against deep shadow, absolutely no text or letters or words, no watermark.`,
    `Bold video thumbnail: ONE single oversized object representing ${topic}, centered, dramatic studio lighting, vivid saturated colors against a clean dark background, extreme contrast, absolutely no text or letters or words, no watermark.`,
    `Bold, high-contrast video thumbnail background about: ${topic}. Dramatic cinematic lighting, vibrant purple and electric blue accents on near-black, abstract shapes suggesting the topic, absolutely no text or letters or words, no watermark.`,
  ];
}

export async function generateThumbnail(
  id: string,
  topic: string,
  title: string,
  /** "b" renders a deliberately different art direction for A/B tests. */
  variant: "a" | "b" = "a",
  /** Full prompt override (Thumbnail Lab variants). */
  promptOverride?: string
): Promise<{ path: string; error?: never } | { path?: never; error: string }> {
  const prompt =
    promptOverride ??
    (variant === "b"
      ? `Photorealistic close-up video thumbnail about: ${topic}. One clear human-scale subject filling the frame, warm golden rim light against deep shadow, strong emotional expression or tension, shallow depth of field, absolutely no text or letters or words, no watermark.`
      : `Bold, high-contrast video thumbnail background about: ${topic}. Dramatic cinematic lighting, vibrant purple and electric blue accents on near-black, abstract shapes suggesting the topic, absolutely no text or letters or words, no watermark.`);
  const bg = await generateBackground(prompt);
  if (!bg) {
    return { error: "no image provider — connect an xAI or OpenAI key in the Operator Console" };
  }

  fs.mkdirSync(RENDERS_DIR, { recursive: true });
  const bgPath = path.join(RENDERS_DIR, `img-${id}-bg.png`);
  const outPath = path.join(RENDERS_DIR, `img-${id}.png`);
  fs.writeFileSync(bgPath, bg);

  const text = sanitizeTitle(title);
  const vf = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,drawtext=text=${text}:font=DejaVu Sans:fontsize=86:fontcolor=white:borderw=8:bordercolor=black:x=(w-tw)/2:y=h-th-70`;
  const res = await run(["-y", "-i", bgPath, "-vf", vf, "-frames:v", "1", outPath], RENDERS_DIR);
  fs.rmSync(bgPath, { force: true });

  if (res.code !== 0 || !fs.existsSync(outPath)) {
    // Text overlay is polish; if drawtext fails (font quirks), ship the plain bg.
    fs.writeFileSync(outPath, bg);
  }
  return { path: path.relative(process.cwd(), outPath) };
}

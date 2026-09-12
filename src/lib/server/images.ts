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
export async function generateThumbnail(
  id: string,
  topic: string,
  title: string
): Promise<{ path: string; error?: never } | { path?: never; error: string }> {
  const prompt = `Bold, high-contrast video thumbnail background about: ${topic}. Dramatic cinematic lighting, vibrant purple and electric blue accents on near-black, abstract shapes suggesting the topic, absolutely no text or letters or words, no watermark.`;
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

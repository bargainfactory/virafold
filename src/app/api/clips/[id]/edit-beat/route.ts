import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getClip, getFlags } from "@/lib/server/db";
import {
  extractThumb,
  planDirFor,
  renderBeatSegment,
  spliceFilm,
  type FilmPlan,
} from "@/lib/server/render";
import { editImage, generateBackground } from "@/lib/server/images";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Scene editor: change ONE scene's visual — by prompt (image-to-image edit of
 * the current still), by re-roll (regenerate from the stored prompt), or by
 * uploading a replacement — then rebuild just that segment and splice the film
 * back together. Audio and timing are untouched, which is what keeps an edit
 * at seconds-and-cents instead of a full re-render.
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
  const gate = rateLimit(`editbeat:${user.email}`, 20, 60 * 60 * 1000);
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

  // Parse the request: JSON (prompt / reroll) or multipart (upload).
  let index = -1;
  let mode = "";
  let instruction = "";
  let uploadBytes: Buffer | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    index = Number(form.get("index"));
    mode = "upload";
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Attach an image up to 8MB" }, { status: 400 });
    }
    uploadBytes = Buffer.from(await file.arrayBuffer());
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    index = Number(body?.index);
    mode = String(body?.mode ?? "");
    instruction = String(body?.instruction ?? "").trim().slice(0, 300);
  }
  const b = plan.beats[index];
  if (!b || !Number.isInteger(index)) {
    return NextResponse.json({ error: "Unknown scene" }, { status: 400 });
  }
  if (mode === "prompt" && instruction.length < 3) {
    return NextResponse.json({ error: "Say what to change about the scene" }, { status: 400 });
  }

  // Produce the new still.
  const basePrompt =
    b.prompt ||
    `Illustration for this narration moment: ${b.text.slice(0, 160)}. Vertical 9:16 composition, no text, no watermark.`;
  let img: Buffer | null = null;
  if (mode === "upload") {
    img = uploadBytes;
  } else if (mode === "reroll") {
    img = await generateBackground(basePrompt);
  } else if (mode === "prompt") {
    // Image-to-image on the beat's reference: the still itself, or — for an
    // animated beat — the source still its motion was generated from.
    const srcAbs = path.join(dir, b.file);
    const refAbs = b.file.endsWith(".png") && fs.existsSync(srcAbs)
      ? srcAbs
      : fs.existsSync(path.join(dir, `beat${index}.png`))
        ? path.join(dir, `beat${index}.png`)
        : null;
    if (refAbs) {
      img = await editImage(
        fs.readFileSync(refAbs),
        `${instruction}. Keep the overall art style, palette, and composition of the image the same. No text, no watermark.`
      );
    }
    if (!img) img = await generateBackground(`${basePrompt} ${instruction}.`);
  } else {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }
  if (!img) {
    return NextResponse.json(
      { error: "No image provider available — connect an image key in the Operator Console" },
      { status: 503 }
    );
  }

  // Swap the beat's visual, rebuild its segment, splice.
  const newName = `edit${index}_${Date.now() % 100000}.png`;
  fs.writeFileSync(path.join(dir, newName), img);
  b.file = newName;
  b.kind = "image"; // edited visuals render as stills with the Ken Burns move
  if (mode === "prompt") b.prompt = `${basePrompt} ${instruction}.`;
  try {
    await renderBeatSegment(dir, plan, b);
    await spliceFilm(dir, plan, path.join(process.cwd(), clip.outputPath));
  } catch (e) {
    return NextResponse.json(
      { error: `Splice failed: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` },
      { status: 500 }
    );
  }
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan), "utf8");
  if (index === 0) await extractThumb({ ...clip, userEmail: user.email }).catch(() => {});
  return NextResponse.json({ ok: true, beat: { i: b.i, file: b.file } });
}

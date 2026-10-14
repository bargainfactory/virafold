import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getFlags, getGenImageFull, insertGenImage, listPersonas } from "@/lib/server/db";
import type { PropType } from "@/lib/server/db";
import { editImage, generateBackground } from "@/lib/server/images";
import { GEN_WRAP, PTYPES } from "@/lib/server/prop-prompts";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Character Builder, step 1: three candidates from one description — or three
 * refinements of a chosen candidate ("same character, but older"). Candidates
 * live in gen_images (served, retention-swept) and only become props when the
 * creator explicitly Accepts one. Distinctness is enforced in the prompt: new
 * characters are told to look clearly different from the existing cast.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  // Each run is three image generations.
  const gate = rateLimit(`charbuild:${user.email}`, 8, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const ptypeRaw = String(b?.ptype ?? "character") as PropType;
  const ptype = PTYPES.has(ptypeRaw) ? ptypeRaw : "character";
  const prompt = String(b?.prompt ?? "").trim().slice(0, 300);
  const refineImageId = b?.refineImageId ? String(b.refineImageId) : "";
  const instruction = String(b?.instruction ?? "").trim().slice(0, 300);

  // Distinctness clause: a new cast member must not blur into the existing one.
  const existing = listPersonas(user.email)
    .filter((p) => (p.ptype === "character" || p.ptype === "presenter") && p.meta)
    .slice(0, 3)
    .map((p) => (p.meta as string).slice(0, 80));
  const distinct =
    ptype === "character" && existing.length
      ? ` This is a NEW character who must look clearly different from the existing cast (different silhouette, hair, outfit colors, and face) — existing cast: ${existing.join(" | ")}.`
      : "";

  const ids: string[] = [];

  if (refineImageId && instruction) {
    // Refinement: three image-to-image edits of the chosen candidate.
    const srcImg = getGenImageFull(user.email, refineImageId);
    if (!srcImg) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    let src: Buffer;
    try {
      src = fs.readFileSync(path.join(process.cwd(), srcImg.path));
    } catch {
      return NextResponse.json({ error: "Candidate image missing" }, { status: 404 });
    }
    const editPrompt = `${instruction}. Keep everything else about the character design exactly the same: same identity, pose style, background, and art style. No text, no watermark.`;
    for (let i = 0; i < 3; i++) {
      const out =
        (await editImage(src, editPrompt)) ??
        // Edit unavailable → regenerate from the original prompt + instruction.
        (await generateBackground(`${srcImg.prompt}. ${instruction}. No text, no watermark.`));
      if (!out) continue;
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      insertGenImage(user.email, id, `${srcImg.prompt} || ${instruction}`.slice(0, 500), saveCandidate(id, out));
      ids.push(id);
    }
  } else {
    if (prompt.length < 5) {
      return NextResponse.json({ error: "Describe the character in a few words" }, { status: 400 });
    }
    const full = GEN_WRAP[ptype](prompt) + distinct;
    for (let i = 0; i < 3; i++) {
      const out = await generateBackground(full);
      if (!out) continue;
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      insertGenImage(user.email, id, prompt.slice(0, 500), saveCandidate(id, out));
      ids.push(id);
    }
  }

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "No image provider available — connect an image key in the Operator Console" },
      { status: 503 }
    );
  }
  return NextResponse.json({ candidates: ids }, { status: 201 });
}

function saveCandidate(id: string, png: Buffer): string {
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `img-${id}.png`);
  fs.writeFileSync(abs, png);
  return path.relative(process.cwd(), abs);
}

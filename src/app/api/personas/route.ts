import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import {
  getFlags,
  insertPersona,
  listPersonas,
  persona360Path,
  setPersonaMeta,
  type PropType,
} from "@/lib/server/db";
import { describeImage, editImage, generateBackground } from "@/lib/server/images";
import fs from "node:fs";
import { rateLimit } from "@/lib/server/rate-limit";
import { GEN_WRAP, PTYPES, VISION } from "@/lib/server/prop-prompts";

export const dynamic = "force-dynamic";

const MAX_PROPS = 24;
const MAX_UPLOAD = 8 * 1024 * 1024;

/**
 * Props library: presenters, characters, products, settings, and style
 * references — generated from a description or uploaded behind an explicit
 * rights attestation. Each prop gets a vision-derived description that scene
 * prompts quote verbatim, which is how videos honor the prop.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ personas: listPersonas(user.email) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  if (listPersonas(user.email).length >= MAX_PROPS) {
    return NextResponse.json(
      { error: `Prop limit reached (${MAX_PROPS}) — delete one to add another.` },
      { status: 422 }
    );
  }
  const gate = rateLimit(`persona:${user.email}`, 20, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";

  // Upload path: multipart with a consent attestation.
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const consent = String(form.get("consent") ?? "") === "true";
    const ptypeRaw = String(form.get("ptype") ?? "presenter") as PropType;
    const ptype = PTYPES.has(ptypeRaw) ? ptypeRaw : "presenter";
    if (!consent) {
      return NextResponse.json(
        { error: "Confirm you have the right to use this image before uploading." },
        { status: 400 }
      );
    }
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Attach an image file" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD) {
      return NextResponse.json({ error: "Image too large (8MB max)" }, { status: 400 });
    }
    const image = Buffer.from(await file.arrayBuffer());
    const persona = insertPersona(user.email, {
      id: `per-${crypto.randomUUID()}`,
      name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || ptype,
      source: "uploaded",
      ptype,
      image,
    });
    // Vision description in the background — the prop is usable immediately
    // and gains prompt-steering power once the description lands.
    describeImage(image, VISION[ptype])
      .then((meta) => meta && setPersonaMeta(user.email, persona.id, meta))
      .catch(() => {});
    return NextResponse.json({ persona }, { status: 201 });
  }

  // Generate path: short description → image via the provider chain.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const prompt = String(b?.prompt ?? "").trim().slice(0, 300);
  const ptypeRaw = String(b?.ptype ?? "presenter") as PropType;
  const ptype = PTYPES.has(ptypeRaw) ? ptypeRaw : "presenter";
  if (prompt.length < 5) {
    return NextResponse.json({ error: "Describe it in a few words" }, { status: 400 });
  }
  const img = await generateBackground(GEN_WRAP[ptype](prompt));
  if (!img) {
    return NextResponse.json(
      { error: "No image provider available — connect an image key in the Operator Console" },
      { status: 503 }
    );
  }
  const persona = insertPersona(user.email, {
    id: `per-${crypto.randomUUID()}`,
    name: prompt.slice(0, 60),
    source: "generated",
    ptype,
    // Generated props start with the user's own words as the description;
    // the vision pass refines it to what the image actually shows.
    meta: prompt.slice(0, 300),
    image: img,
  });
  describeImage(img, VISION[ptype])
    .then((meta) => meta && setPersonaMeta(user.email, persona.id, meta))
    .catch(() => {});
  // 360° profile (characters and presenters): a multi-view turnaround sheet
  // generated from the approved portrait — the identity anchor that keeps
  // the character consistent across every scene, the way AI-film character
  // sheets do (front/three-quarter/profile/back + a close-up detail panel).
  // Best-effort and async: the persona is usable immediately either way.
  if (ptype === "character" || ptype === "presenter") {
    editImage(
      img,
      "Character turnaround reference sheet of the EXACT same character from the image — identical face, hair, outfit, colors and proportions — shown in four full-body views side by side on one plain light background: front view, three-quarter view, side profile, and back view, all in the same neutral standing pose, plus one close-up head-and-shoulders detail panel. Clean studio reference sheet, consistent flat lighting, absolutely no text, letters, labels or arrows."
    )
      .then((sheet) => {
        if (sheet) fs.writeFileSync(persona360Path(persona.id), sheet);
      })
      .catch(() => {});
  }
  return NextResponse.json({ persona }, { status: 201 });
}

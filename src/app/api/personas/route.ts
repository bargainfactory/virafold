import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { getFlags, insertPersona, listPersonas } from "@/lib/server/db";
import { generateBackground } from "@/lib/server/images";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const MAX_PERSONAS = 12;
const MAX_UPLOAD = 8 * 1024 * 1024;

/**
 * UGC presenter personas: either AI-generated from a short description, or an
 * uploaded photo the creator attests they have the right to use. The consent
 * attestation on uploads is deliberate — animate-a-photo is deepfake-adjacent,
 * so the rights claim is recorded as part of the request, not assumed.
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
  if (listPersonas(user.email).length >= MAX_PERSONAS) {
    return NextResponse.json(
      { error: `Persona limit reached (${MAX_PERSONAS}) — delete one to add another.` },
      { status: 422 }
    );
  }
  const gate = rateLimit(`persona:${user.email}`, 15, 60 * 60 * 1000);
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
    const persona = insertPersona(user.email, {
      id: `per-${crypto.randomUUID()}`,
      name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Uploaded presenter",
      source: "uploaded",
      image: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ persona }, { status: 201 });
  }

  // Generate path: short description → portrait via the image provider chain.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const prompt = String((body as Record<string, unknown>)?.prompt ?? "").trim().slice(0, 300);
  if (prompt.length < 5) {
    return NextResponse.json({ error: "Describe the presenter in a few words" }, { status: 400 });
  }
  const img = await generateBackground(
    `Photorealistic UGC creator portrait: ${prompt}. Person facing the camera, head and shoulders, natural smartphone-video look, soft daylight, believable casual setting, vertical 9:16 composition, no text, no watermark.`
  );
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
    image: img,
  });
  return NextResponse.json({ persona }, { status: 201 });
}

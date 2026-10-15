import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getSessionUser } from "@/lib/server/auth";
import { deletePersona, getPersona, personaImagePath, setPersonaVoice } from "@/lib/server/db";

const VOICES = new Set(["", "eve", "luna", "orion", "perseus", "helix"]);

export const dynamic = "force-dynamic";

/** Owner-only persona image. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!getPersona(user.email, id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const bytes = fs.readFileSync(personaImagePath(id));
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

/** Assign the character's spoken voice for dialogue lines. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!getPersona(user.email, id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let voice = "";
  try {
    voice = String(((await req.json()) as Record<string, unknown>)?.voice ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!VOICES.has(voice)) return NextResponse.json({ error: "Unknown voice" }, { status: 400 });
  setPersonaVoice(user.email, id, voice || null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  deletePersona(user.email, id);
  return NextResponse.json({ ok: true });
}

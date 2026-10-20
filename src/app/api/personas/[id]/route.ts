import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getSessionUser } from "@/lib/server/auth";
import { deletePersona, getPersona, personaImagePath, setPersonaCharname, setPersonaVoice } from "@/lib/server/db";
import { XAI_VOICE_ROSTER } from "@/lib/server/dialogue";

const VOICES = new Set(["", ...XAI_VOICE_ROSTER.map((v) => v.id)]);

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

/** Assign the character's spoken voice and/or script name for dialogue lines. */
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
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.voice !== undefined) {
    const voice = String(body.voice ?? "");
    if (!VOICES.has(voice)) return NextResponse.json({ error: "Unknown voice" }, { status: 400 });
    setPersonaVoice(user.email, id, voice || null);
  }
  if (body.charname !== undefined) {
    // The speaker tag this prop answers to in screenplays — same shape the
    // screenplay parser accepts (uppercase, letters/digits/space/.'-).
    const raw = String(body.charname ?? "").trim().toUpperCase().slice(0, 25);
    if (raw && !/^[A-Z][A-Z0-9 .'-]{0,24}$/.test(raw)) {
      return NextResponse.json({ error: "Script name: letters and digits only, e.g. ELI" }, { status: 400 });
    }
    setPersonaCharname(user.email, id, raw || null);
  }
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

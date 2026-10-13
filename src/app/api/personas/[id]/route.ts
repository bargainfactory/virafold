import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getSessionUser } from "@/lib/server/auth";
import { deletePersona, getPersona, personaImagePath } from "@/lib/server/db";

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

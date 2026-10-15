import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { deleteGenImage, getGenImage } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const img = getGenImage(user.email, id);
  if (!img) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const abs = path.join(process.cwd(), img.path);
  if (!fs.existsSync(abs)) return NextResponse.json({ error: "File missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(abs)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
  });
}

/** Remove a generated image (thumbnail variants users rejected). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  deleteGenImage(user.email, id);
  return NextResponse.json({ ok: true });
}

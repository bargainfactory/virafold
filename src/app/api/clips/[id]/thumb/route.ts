import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getClip } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** The clip's auto-extracted first-picture thumbnail (card poster). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip?.thumbPath) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), clip.thumbPath));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

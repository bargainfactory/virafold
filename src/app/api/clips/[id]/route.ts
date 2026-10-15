import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { deleteClip, getClip, getProjectMedia, updateClip } from "@/lib/server/db";
import { estimateWords } from "@/lib/server/clips";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Words inside the clip window power the in-browser caption preview.
  // Same fallback chain as the renderer, so the preview matches the output.
  const media = getProjectMedia(user.email, clip.projectId);
  let words =
    media?.words ??
    (media?.transcript && media.durationSec
      ? estimateWords(media.transcript, media.durationSec)
      : []);
  words = words.filter((w) => w.e > clip.startSec - 0.5 && w.s < clip.endSec + 0.5);

  return NextResponse.json({ clip, words });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (clip.outputPath) {
    try {
      fs.rmSync(path.join(process.cwd(), clip.outputPath), { force: true });
    } catch {
      /* file cleanup is best-effort */
    }
  }
  deleteClip(user.email, id);
  return NextResponse.json({ ok: true });
}

/** Rename a video — the title rides into YouTube/TikTok at publish time. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!getClip(user.email, id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let title = "";
  try {
    title = String(((await req.json()) as Record<string, unknown>)?.title ?? "").trim().slice(0, 120);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (title.length < 3) {
    return NextResponse.json({ error: "Give the video a title (3+ characters)" }, { status: 400 });
  }
  updateClip(user.email, id, { title });
  return NextResponse.json({ clip: getClip(user.email, id) });
}

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import { getClip } from "@/lib/server/db";
import { planDirFor, type FilmPlan } from "@/lib/server/render";

export const dynamic = "force-dynamic";

const ASSET_RE = /^(beat|anim|broll|edit|prev)[0-9_]+\.(png|jpg|mp4)$/;

/**
 * Scene-editor bootstrap: the persisted build plan's beats (text, timing,
 * kind, whether the visual is an image we can preview/edit). ?asset=<file>
 * streams one beat source for the filmstrip (whitelisted names only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip?.hasPlan) return NextResponse.json({ error: "No edit plan for this video" }, { status: 404 });
  const dir = planDirFor(id);

  const asset = req.nextUrl.searchParams.get("asset");
  if (asset) {
    if (!ASSET_RE.test(asset)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
      const bytes = fs.readFileSync(path.join(dir, asset));
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": asset.endsWith(".mp4") ? "video/mp4" : asset.endsWith(".jpg") ? "image/jpeg" : "image/png",
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  try {
    const plan = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")) as FilmPlan;
    // Every beat gets a previewable reference image, including animated and
    // b-roll beats: the source still the motion was generated from when it
    // exists, else a frame extracted once from the video and cached.
    const { extractBeatPreview } = await import("@/lib/server/render");
    const beats = await Promise.all(
      plan.beats.map(async (b) => {
        const isImg = b.file.endsWith(".png") || b.file.endsWith(".jpg");
        let preview: string | null = isImg ? b.file : null;
        if (!preview) {
          const still = `beat${b.i}.png`;
          if (fs.existsSync(path.join(dir, still))) preview = still;
          else preview = await extractBeatPreview(dir, b).catch(() => null);
        }
        return {
          i: b.i,
          text: b.text,
          start: b.start,
          dur: b.dur,
          kind: b.kind,
          file: b.file,
          image: isImg,
          preview,
        };
      })
    );
    return NextResponse.json({ beats, duration: plan.duration, wide: Boolean(plan.wide) });
  } catch {
    return NextResponse.json({ error: "Plan unreadable" }, { status: 500 });
  }
}

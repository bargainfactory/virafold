import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { getClip, updateClip } from "@/lib/server/db";
import {
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  CROP_FOCUSES,
  kickRenderWorker,
  type CaptionPosition,
  type CaptionStyle,
  type CropFocus,
} from "@/lib/server/render";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Queue a clip for rendering with the chosen caption style. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Renders are CPU work on a shared box; bound per-account volume.
  const gate = rateLimit(`render:${user.email}`, 20, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const clip = getClip(user.email, id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (clip.status === "rendering" || clip.status === "queued") {
    return NextResponse.json({ clip });
  }

  let style: CaptionStyle = "bold";
  let position: CaptionPosition = "bottom";
  let focus: CropFocus = "center";
  let tight = 1;
  try {
    const body = (await req.json()) as {
      style?: string;
      position?: string;
      focus?: string;
      tight?: boolean;
    };
    if (body?.tight === false) tight = 0;
    if (body?.style && (CAPTION_STYLES as readonly string[]).includes(body.style)) {
      style = body.style as CaptionStyle;
    }
    if (body?.position && (CAPTION_POSITIONS as readonly string[]).includes(body.position)) {
      position = body.position as CaptionPosition;
    }
    if (body?.focus && (CROP_FOCUSES as readonly string[]).includes(body.focus)) {
      focus = body.focus as CropFocus;
    }
  } catch {
    /* defaults */
  }

  updateClip(user.email, id, { status: "queued", style, position, focus, tight, error: null });
  kickRenderWorker();
  return NextResponse.json({ clip: getClip(user.email, id) });
}

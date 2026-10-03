import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import {
  getPostViews,
  getScheduledPost,
  getThumbTest,
  insertThumbTest,
} from "@/lib/server/db";
import { generateThumbnail } from "@/lib/server/images";
import { setYouTubeThumbnail } from "@/lib/server/connect";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const SWAP_AFTER_H = 72;
const DECIDE_AFTER_H = 144;

/** Current A/B state for the post (drives the modal's button/status). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const test = getThumbTest(user.email, id);
  return NextResponse.json({ test });
}

/**
 * Start a thumbnail A/B on a published YouTube video: two AI thumbnails in
 * deliberately different art directions, A set immediately, B swapped in at
 * 72h, winner decided at 144h by views-per-hour in each window and set back.
 * Honest caveat baked into the verdict: views-rate comparison is confounded
 * by natural decay — it favors B less over time, so a B win is meaningful,
 * an A win is weaker evidence.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`thumbab:${user.email}`, 4, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const post = getScheduledPost(user.email, id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.platform !== "YouTube" || post.status !== "published" || !post.externalId) {
    return NextResponse.json(
      { error: "Thumbnail tests need a published YouTube post" },
      { status: 400 }
    );
  }
  if (getThumbTest(user.email, id)) {
    return NextResponse.json({ error: "A test is already running on this post" }, { status: 409 });
  }

  const a = await generateThumbnail(`ab-${id}-a`, post.assetName, post.assetName, "a");
  const b = await generateThumbnail(`ab-${id}-b`, post.assetName, post.assetName, "b");
  if (a.error || b.error || !a.path || !b.path) {
    return NextResponse.json({ error: a.error ?? b.error ?? "thumbnail generation failed" }, { status: 503 });
  }

  const set = await setYouTubeThumbnail(
    user.email,
    post.externalId,
    fs.readFileSync(path.join(process.cwd(), a.path))
  );
  if (!set.ok) return NextResponse.json({ error: set.detail }, { status: 502 });

  insertThumbTest({
    postId: id,
    userEmail: user.email,
    videoId: post.externalId,
    imageA: a.path,
    imageB: b.path,
    swapAt: new Date(Date.now() + SWAP_AFTER_H * 3600_000).toISOString(),
    decideAt: new Date(Date.now() + DECIDE_AFTER_H * 3600_000).toISOString(),
    viewsAtStart: getPostViews(user.email, id),
  });
  return NextResponse.json({ ok: true, swapInHours: SWAP_AFTER_H, decideInHours: DECIDE_AFTER_H });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import {
  getAutopilot,
  listDraftPosts,
  listFailedClips,
  listFailedVerifiedPosts,
  listReadyUnscheduledClips,
  setScheduledStatus,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";

/**
 * Review Inbox: everything waiting on the creator's judgment, in one list.
 * Projects-in-review and honesty-flagged assets ride the bootstrap the client
 * already holds; this route adds the server-only item types.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    clipsReady: listReadyUnscheduledClips(user.email),
    clipsFailed: listFailedClips(user.email),
    postsFailed: listFailedVerifiedPosts(user.email),
    postsDraft: listDraftPosts(user.email),
    autopilot: getAutopilot(user.email),
  });
}

/** Inbox actions on drafted posts: approve (goes live on schedule) or dismiss. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const action = String(b?.action ?? "");
  const id = String(b?.id ?? "");
  if (!id || (action !== "approvePost" && action !== "dismissPost")) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  // Only drafts may be approved/dismissed through the inbox — live posts are
  // managed in the Schedule tab.
  const current = listDraftPosts(user.email).find((p) => p.id === id);
  if (!current) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  const post = setScheduledStatus(user.email, id, action === "approvePost" ? "scheduled" : "canceled");
  return NextResponse.json({ post });
}

import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/server/auth";
import { compileOpsDigest, runOpsDigest } from "@/lib/server/ops-digest";

export const dynamic = "force-dynamic";

/** The operator's on-demand "brief me now" — same compilation the daily
 *  digest emails at ~4am. GET previews without sending; POST also delivers
 *  the notification + email to every admin. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(compileOpsDigest());
}

export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const digest = await runOpsDigest();
  return NextResponse.json({ ...digest, sent: true });
}

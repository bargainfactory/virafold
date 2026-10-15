import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { seriesProgress } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** The launch playbook as live state — see seriesProgress() in db. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(seriesProgress(user.email));
}

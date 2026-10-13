import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { bestHourMap, fillWeek } from "@/lib/server/autopilot";

export const dynamic = "force-dynamic";

/**
 * Smart scheduling: per-platform best-hour recommendations from the
 * creator's own measured results (sensible defaults until data exists),
 * and one-click "Fill my week" distribution of ready assets. The strategy
 * lives in autopilot.ts, shared with the Monday autopilot drafting run.
 */

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ bestTimes: bestHourMap(user.email) });
}

/** Fill the next 7 days: one ready asset per day at its platform's best hour. */
export async function POST(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const posts = fillWeek(user.email, "scheduled");
  if (!posts.length) {
    return NextResponse.json(
      { error: "No unscheduled assets to place — generate or approve some first" },
      { status: 422 }
    );
  }
  return NextResponse.json({ posts, bestTimes: bestHourMap(user.email) }, { status: 201 });
}

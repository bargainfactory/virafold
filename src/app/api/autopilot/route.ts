import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { getAutopilot, setAutopilot } from "@/lib/server/db";
import { runAutopilotFor } from "@/lib/server/autopilot";

export const dynamic = "force-dynamic";

/**
 * Weekly autopilot opt-in. Turning it on immediately drafts this week (if
 * there is anything to place), so the creator sees what autopilot does the
 * moment they enable it instead of waiting for Monday.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ autopilot: getAutopilot(user.email) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let on = false;
  try {
    on = Boolean(((await req.json()) as Record<string, unknown>)?.on);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  setAutopilot(user.email, on);
  const drafted = on ? runAutopilotFor(user.email) : 0;
  return NextResponse.json({ autopilot: on, drafted });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { bestPlanFor, getFlags, insertAmbientVideo } from "@/lib/server/db";
import { AMBIENT_SOUNDSCAPES, kickRenderWorker } from "@/lib/server/render";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Ambient loop video: a seamless sleep/relaxation render (AI still + glacial
 * drift + synthesized soundscape) up to an hour long. Paid plans — long
 * renders occupy the shared worker and an hour of 1080p is real storage.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }
  if (bestPlanFor(user.email) === "Free") {
    return NextResponse.json(
      { error: "Ambient videos are included on paid plans — upgrade to render sleep-length loops." },
      { status: 403 }
    );
  }

  const gate = rateLimit(`amb:${user.email}`, 4, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const theme = String(b?.theme ?? "").trim().slice(0, 140);
  const minutes = Math.round(Number(b?.minutes) || 30);
  const soundscape = (AMBIENT_SOUNDSCAPES as readonly string[]).includes(String(b?.soundscape))
    ? String(b?.soundscape)
    : "ocean";
  if (theme.length < 3) {
    return NextResponse.json({ error: "Describe the scene in a few words" }, { status: 400 });
  }
  if (minutes < 5 || minutes > 60) {
    return NextResponse.json({ error: "Length must be between 5 and 60 minutes" }, { status: 400 });
  }

  const title = `${theme.slice(0, 80)} — ${minutes} min ${soundscape}`;
  const clip = insertAmbientVideo(user.email, {
    id: `amb-${crypto.randomUUID()}`,
    title,
    config: JSON.stringify({ theme, minutes, soundscape }),
  });
  kickRenderWorker();
  return NextResponse.json({ clip }, { status: 201 });
}

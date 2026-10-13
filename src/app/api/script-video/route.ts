import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { bestPlanFor, getFlags, insertScriptVideo } from "@/lib/server/db";
import { CAPTION_POSITIONS, CAPTION_STYLES, kickRenderWorker } from "@/lib/server/render";
import { animSecondsLeft } from "@/lib/server/video-gen";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Script-to-video: queue a TTS-narrated, caption-burned vertical video from
 * typed text. Renders through the same worker and delivery path as clips.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }

  // TTS is a paid call per render; bound per-account volume.
  const gate = rateLimit(`sv:${user.email}`, 10, 60 * 60 * 1000);
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
  const title = String(b?.title ?? "").trim().slice(0, 120);
  const script = String(b?.script ?? "").trim().slice(0, 4800);
  const style = (CAPTION_STYLES as readonly string[]).includes(String(b?.style))
    ? String(b?.style)
    : "bold";
  const position = (CAPTION_POSITIONS as readonly string[]).includes(String(b?.position))
    ? String(b?.position)
    : "middle";
  if (!title || script.length < 40) {
    return NextResponse.json(
      { error: "A title and a script of at least 40 characters are required" },
      { status: 400 }
    );
  }

  // AI motion is per-second billed upstream — gated by the plan's monthly
  // animation allowance. Zero allowance (Free) gets a clear upgrade message;
  // a partially spent allowance still renders, animating what it can cover.
  const animate = Boolean(b?.animate);
  if (animate) {
    const left = animSecondsLeft(bestPlanFor(user.email), user.email);
    if (left <= 0) {
      return NextResponse.json(
        {
          error:
            "AI motion is available on paid plans and your monthly animation allowance is used up or not included — the video will still render with cinematic stills if you re-try without it.",
        },
        { status: 402 }
      );
    }
  }

  const clip = insertScriptVideo(user.email, {
    id: `sv-${crypto.randomUUID()}`,
    title,
    script,
    style,
    position,
    animate,
  });
  kickRenderWorker();
  return NextResponse.json({ clip }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { FRAMES_DIR } from "@/lib/server/video-gen";

export const dynamic = "force-dynamic";

/**
 * One-time public frame serving for the Imagine Video API, which fetches its
 * input image by URL. Frames live only for the duration of a generation
 * (written and deleted by animateStill), are named by 128-bit random tokens,
 * and contain nothing but an AI-generated still — unguessable and harmless,
 * which is why this route is deliberately unauthenticated.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Reference media for generation requests: stills, plus the spoken-line
  // audio that drives lip-synced close-ups. Same one-time token lifecycle.
  const types: [string, string][] = [
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".mp3", "audio/mpeg"],
    [".wav", "audio/wav"],
  ];
  for (const [ext, mime] of types) {
    try {
      const bytes = fs.readFileSync(path.join(FRAMES_DIR, `${token}${ext}`));
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: { "Content-Type": mime, "Cache-Control": "no-store" },
      });
    } catch {
      /* try next extension */
    }
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

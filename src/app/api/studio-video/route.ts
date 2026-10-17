import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import {
  bestPlanFor,
  getBrandVoice,
  getFlags,
  getPersona,
  insertAmbientVideo,
  insertScriptVideo,
} from "@/lib/server/db";
import { kickRenderWorker } from "@/lib/server/render";
import { VIDEO_STYLES } from "@/lib/server/scenes";
import { generateScript } from "@/lib/server/generate";
import { animSecondsLeft } from "@/lib/server/video-gen";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Animation Studio: one input — an idea OR a full script — plus a visual
 * style, out comes a narrated, captioned, styled vertical video. Short input
 * gets a script written first (same writer the Ideas tab uses); long input is
 * treated as the script itself. Renders through the standard clips queue.
 */

// Inputs this long read as scripts; anything shorter is an idea to write from.
const SCRIPT_THRESHOLD = 400;

/** Contextual soundscape choice for ambient renders, read from the idea text. */
function inferSoundscape(text: string): string {
  const t = text.toLowerCase();
  if (/thunder|lightning|storm/.test(t)) return "thunder";
  if (/rain|drizzle|droplet|monsoon/.test(t)) return "rain";
  if (/waterfall|cascade|creek|stream|river/.test(t)) return "waterfall";
  if (/ocean|sea|wave|beach|coast|shore|tide/.test(t)) return "ocean";
  if (/wind|breeze|mountain|desert|snow|blizzard|tundra/.test(t)) return "wind";
  if (/cat|purr|kitten/.test(t)) return "purr";
  if (/focus|study|meditat|binaural|deep sleep/.test(t)) return "binaural";
  if (/fireplace|cozy|cabin|night|space|void/.test(t)) return "brown-noise";
  return "ocean";
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }

  // Shares the script-video bucket — TTS + image generation cost per render.
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
  const rawInput = String(b?.input ?? "").trim();
  const { parseScreenplay } = await import("@/lib/server/dialogue");
  const isScreenplay = Boolean(parseScreenplay(rawInput));
  const input = rawInput.slice(0, isScreenplay ? 24000 : 6000);
  const style = String(b?.style ?? "documentary");
  const animate = b?.animate === undefined ? true : Boolean(b.animate);
  const locale = b?.locale ? String(b.locale).slice(0, 8) : undefined;
  if (input.length < 10) {
    return NextResponse.json(
      { error: "Describe your idea (a sentence is enough) or paste a full script." },
      { status: 400 }
    );
  }
  if (style !== "documentary" && style !== "ambient" && !VIDEO_STYLES[style]) {
    return NextResponse.json({ error: "Unknown style" }, { status: 400 });
  }

  // Ambient: the idea text IS the scene; the soundscape is inferred from it.
  // Same gates as the dedicated ambient form (paid plans, long renders).
  if (style === "ambient") {
    if (bestPlanFor(user.email) === "Free") {
      return NextResponse.json(
        { error: "Ambient videos are included on paid plans — upgrade to render sleep-length loops." },
        { status: 403 }
      );
    }
    const ambGate = rateLimit(`amb:${user.email}`, 4, 60 * 60 * 1000);
    if (!ambGate.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(ambGate.retryAfterSeconds) } }
      );
    }
    const theme = input.slice(0, 140);
    const soundscape = inferSoundscape(input);
    const minutes = 30;
    const clip = insertAmbientVideo(user.email, {
      id: `amb-${crypto.randomUUID()}`,
      title: `${theme.slice(0, 80)} — ${minutes} min ${soundscape}`,
      config: JSON.stringify({ theme, minutes, soundscape }),
    });
    kickRenderWorker();
    return NextResponse.json({ clip }, { status: 201 });
  }

  // Props: up to 4 owned library items (characters/products/settings/styles)
  // whose vision descriptions steer every scene.
  const propIds = Array.isArray(b?.propIds)
    ? (b.propIds as unknown[]).map(String).slice(0, 4).filter((id) => getPersona(user.email, id))
    : [];

  // UGC spokesperson mode needs a presenter the user owns.
  let personaId: string | undefined;
  if (style === "ugc") {
    personaId = String(b?.personaId ?? "");
    if (!personaId || !getPersona(user.email, personaId)) {
      return NextResponse.json(
        { error: "Pick or create a presenter first — UGC videos are fronted by one." },
        { status: 400 }
      );
    }
  }

  if (animate && animSecondsLeft(bestPlanFor(user.email), user.email) <= 0) {
    return NextResponse.json(
      {
        error:
          "AI motion is available on paid plans and your monthly animation allowance is used up or not included — turn it off to render with cinematic stills.",
      },
      { status: 402 }
    );
  }

  // Idea → script via the same writer the Ideas tab uses; long input IS the script.
  let script = input;
  let title: string;
  if (input.length < SCRIPT_THRESHOLD) {
    const firstLine = input.split("\n")[0].trim();
    title = firstLine.slice(0, 100);
    const notes = input.slice(firstLine.length).trim();
    const written = await generateScript(title, notes, locale, getBrandVoice(user.email));
    if (!written.script || written.script.length < 40) {
      return NextResponse.json(
        { error: "Could not write a script from that idea — add a little more detail and retry." },
        { status: 502 }
      );
    }
    script = written.script;
  } else {
    title = input.split(/[.!?\n]/)[0].trim().slice(0, 100) || "Studio video";
  }

  // Motion-picture options: landscape renders a 16:9 feature; fullMotion
  // animates every scene instead of the 8 highlights (billed per second of
  // generated motion, so it stays an explicit opt-in).
  const orient = b?.orient === "landscape" ? "landscape" : undefined;
  const fullMotion = animate && Boolean(b?.fullMotion);
  const clip = insertScriptVideo(user.email, {
    id: `sv-${crypto.randomUUID()}`,
    title,
    script: script.slice(0, isScreenplay ? 24000 : 4800),
    style: "bold",
    position: orient ? "bottom" : "middle",
    animate: fullMotion ? 2 : animate,
    vstyle: style === "documentary" ? undefined : style,
    personaId,
    props: propIds,
    orient,
  });
  kickRenderWorker();
  return NextResponse.json({ clip }, { status: 201 });
}

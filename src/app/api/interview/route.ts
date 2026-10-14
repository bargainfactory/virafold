import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { getFlags } from "@/lib/server/db";
import { transcribeMedia } from "@/lib/server/transcribe";
import { llmComplete } from "@/lib/server/generate";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * "Talk it out" interviewer: the blank-page killer. The creator answers a few
 * sharp questions out loud; answers are transcribed (existing STT chain) and
 * the next question is written from what they actually said. The compiled
 * Q&A transcript then feeds the normal project pipeline client-side.
 */

const NEXT_Q_SCHEMA = {
  type: "object",
  properties: { question: { type: "string" }, done: { type: "boolean" } },
  required: ["question", "done"],
  additionalProperties: false,
};

const INTERVIEWER = [
  "You are a sharp, warm podcast interviewer helping a creator turn their expertise into content.",
  "Given the conversation so far, ask ONE next question that digs for a story, a number, a contrarian opinion, or a concrete how-to the audience could use.",
  "Keep it under 25 words, conversational, no preamble. Never repeat ground already covered.",
  "Set done=true only when 4+ answers exist and the material already has a clear arc.",
].join("\n");

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getFlags().generationEnabled) {
    return NextResponse.json({ error: "Generation is temporarily disabled" }, { status: 503 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  // Audio answer → text, via the existing Deepgram → xAI → Whisper chain.
  if (contentType.includes("multipart/form-data")) {
    const gate = rateLimit(`intv:${user.email}`, 40, 60 * 60 * 1000);
    if (!gate.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
      );
    }
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No audio received — check microphone access" }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "Answer too long — keep each one under a few minutes" }, { status: 400 });
    }
    const result = await transcribeMedia(
      Buffer.from(await file.arrayBuffer()),
      file.name || "answer.webm",
      file.type || "audio/webm"
    );
    if (!result?.text?.trim()) {
      return NextResponse.json(
        { error: "Could not transcribe that — check that a transcription or xAI key is configured, and try again." },
        { status: 503 }
      );
    }
    return NextResponse.json({ text: result.text.trim() });
  }

  // Next question from the conversation so far.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const topic = String(b?.topic ?? "").trim().slice(0, 200);
  const qa = Array.isArray(b?.qa)
    ? (b.qa as { q?: unknown; a?: unknown }[])
        .map((x) => ({ q: String(x?.q ?? "").slice(0, 300), a: String(x?.a ?? "").slice(0, 2000) }))
        .filter((x) => x.q && x.a)
        .slice(0, 8)
    : [];
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });

  // Opening question costs nothing — only follow-ups consult the model.
  if (qa.length === 0) {
    return NextResponse.json({
      question: `What's the one thing about ${topic} you find yourself explaining to people over and over?`,
      done: false,
    });
  }

  const res = await llmComplete(
    INTERVIEWER,
    `Topic: ${topic}\n\nConversation so far:\n${qa.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a}`).join("\n\n")}`,
    NEXT_Q_SCHEMA as unknown as Record<string, unknown>,
    { tier: "standard", maxTokens: 200, context: "interview" }
  );
  if (!res) {
    return NextResponse.json({ question: "", done: true }); // wrap up gracefully
  }
  try {
    const parsed = JSON.parse(res.text) as { question?: string; done?: boolean };
    return NextResponse.json({
      question: String(parsed.question ?? "").slice(0, 300),
      done: Boolean(parsed.done) || qa.length >= 6,
    });
  } catch {
    return NextResponse.json({ question: "", done: true });
  }
}

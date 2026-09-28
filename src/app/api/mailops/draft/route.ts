import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resolveField } from "@/lib/server/integrations";
import { llmComplete } from "@/lib/server/generate";
import { insertEvent } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Inbox draft assistant: called by the Gmail Apps Script on justin@virafold.ai
 * whenever a real person replies. Returns a DRAFT reply — the human reads,
 * edits, and sends. Auth: shared bearer secret (email integration →
 * draftSecret) known only to the console and the Apps Script.
 */

const DRAFT_SCHEMA = {
  type: "object",
  properties: { reply: { type: "string" } },
  required: ["reply"],
} as const;

const SYSTEM = [
  "You draft email replies for Justin Faye, the founder of Virafold (virafold.ai), an AI content-repurposing platform. The draft will be reviewed and edited by Justin before sending — write it ready-to-send.",
  "Voice: warm, direct, plain text, under 140 words. No corporate filler, no exclamation-mark enthusiasm. Sign off with: — Justin",
  "HARD RULES — never break these:",
  "1. Never invent statistics, case studies, customer names, or results. Virafold has no public case studies yet.",
  "2. Only these offers exist: the free website score (virafold.ai/tools/website-score), the $49 Complete Content Audit (same-day, written fixes, not charged if the report can't be produced), the $349 Agency Audit Pack (10 audit credits), the $29 Podcast Episode Kit, and subscription plans from $189 to $2,497/month at virafold.ai/pricing. Never invent discounts or new offers.",
  "3. Refund/billing questions: point to virafold.ai/refunds, be generous in tone, and say Justin will sort it out personally.",
  "4. If the sender asks something you cannot know (their account state, a technical failure, a partnership decision), the draft should say Justin will look into it and follow up — never fabricate an answer.",
  "5. If the sender says stop/unsubscribe/not interested: thank them briefly, confirm they won't hear from us again, no counter-pitch.",
  "6. If the message is clearly automated (receipt, newsletter, notification), reply with exactly: NO_REPLY_NEEDED",
].join("\n");

export async function POST(req: NextRequest) {
  const secret = (resolveField("email", "draftSecret") ?? "").trim();
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "Draft assistant not configured" }, { status: 503 });
  }
  const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(auth);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gate = rateLimit("mailops:draft", 30, 60 * 60 * 1000);
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
  const b2 = body as Record<string, unknown>;
  const from = String(b2?.from ?? "").slice(0, 200);
  const subject = String(b2?.subject ?? "").slice(0, 300);
  const message = String(b2?.message ?? "").slice(0, 4000);
  if (!message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const res = await llmComplete(
    SYSTEM,
    [
      `Incoming email to justin@virafold.ai — draft the reply.`,
      `From: ${from}`,
      `Subject: ${subject}`,
      ``,
      `Message:`,
      message,
    ].join("\n"),
    DRAFT_SCHEMA as unknown as Record<string, unknown>,
    { tier: "standard", maxTokens: 600, context: "mailops-draft" }
  );
  if (!res) {
    return NextResponse.json({ error: "Draft engine unavailable" }, { status: 503 });
  }

  let reply = "";
  try {
    reply = String((JSON.parse(res.text) as { reply?: string }).reply ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Malformed draft" }, { status: 502 });
  }
  if (!reply || reply === "NO_REPLY_NEEDED") {
    return NextResponse.json({ skip: true });
  }
  insertEvent("mailops_draft", from.slice(0, 100), res.engine);
  return NextResponse.json({ reply });
}

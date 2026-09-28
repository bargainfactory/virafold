import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/server/auth";
import { insertEvent } from "@/lib/server/db";
import { analyzeSite } from "@/lib/server/website-score";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * SMB outbound kit (operator-only): score one prospect's site and draft the
 * outreach email around its two weakest areas. Deterministic template + the
 * analyzer's own findings — no LLM, no invented claims; every number in the
 * email is the real score. The console card loops a pasted list through this
 * one URL at a time.
 */
export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Polite crawling even for ourselves: bound the pace.
  const gate = rateLimit(`prospect:${admin.email}`, 40, 60 * 60 * 1000);
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
  const url = String((body as Record<string, unknown>)?.url ?? "").trim().slice(0, 300);
  if (!url) return NextResponse.json({ error: "A URL is required" }, { status: 400 });

  const result = await analyzeSite(url, { maxPages: 4 });
  if (!result.ok) {
    return NextResponse.json({ url, ok: false, error: result.error });
  }
  const r = result.report;
  let host = url;
  try {
    host = new URL(r.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep raw */
  }

  // The two weakest sections, each with its first (most important) note.
  const weakest = [...r.sections].sort((a, b) => a.score - b.score).slice(0, 2);
  const findings = weakest.map((s) => `${s.label} (${s.score}/20): ${s.notes[0] ?? "room to improve"}`);

  const scoreUrl = `https://virafold.ai/tools/website-score?url=${encodeURIComponent(r.url)}`;
  const auditUrl = `https://virafold.ai/site-audit?url=${encodeURIComponent(r.url)}`;
  const subject = `${host} scored ${r.total}/100 for content & AI findability`;
  const emailBody = [
    `Hi,`,
    ``,
    `I run Virafold, a tool that analyzes how findable a website is — in Google and in AI assistants like ChatGPT and Perplexity. I ran ${host} through it today: it scored ${r.total}/100 (grade ${r.grade}) across ${r.fetchedPages} pages.`,
    ``,
    `Two things that stood out:`,
    ...findings.map((f) => `- ${f}`),
    ``,
    `You can re-run the full check yourself, free and without signing up: ${scoreUrl}`,
    ``,
    `If you'd like the fixes written out — exact page titles, meta descriptions, and a 30-day plan — we do a complete audit of up to 120 pages for $49, and you don't pay if we can't produce the report: ${auditUrl}`,
    ``,
    `Either way, the free report above is yours to keep.`,
    ``,
    `— Justin Faye`,
    `Virafold · virafold.ai · justin@virafold.ai`,
  ].join("\n");

  insertEvent("prospect_scored", host, String(r.total));
  return NextResponse.json({
    url: r.url,
    ok: true,
    score: r.total,
    grade: r.grade,
    findings,
    email: { subject, body: emailBody },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { analyzeSite } from "@/lib/server/website-score";
import { insertEvent } from "@/lib/server/db";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Free website content score: deterministic crawl of ~8 pages, graded /100.
 * Rate-limited because each run fetches a third-party site on our bandwidth;
 * zero LLM spend by design.
 */
export async function POST(req: NextRequest) {
  const gate = rateLimit(`wscore:${clientIp(req)}`, 5, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Rate limit reached — try again in a bit" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const url = String((body as Record<string, unknown>)?.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "Enter your website's address" }, { status: 400 });

  const result = await analyzeSite(url, { maxPages: 8 });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

  insertEvent("tool_website_score", "/tools/website-score", `${result.report.total} ${result.report.url.slice(0, 80)}`);
  return NextResponse.json({ report: result.report });
}

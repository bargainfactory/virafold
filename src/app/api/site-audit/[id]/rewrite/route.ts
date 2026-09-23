import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getRealSessionUser } from "@/lib/server/auth";
import { getContentTranslation, getSiteAudit, setContentTranslation } from "@/lib/server/db";
import { fetchPageCheck } from "@/lib/server/website-score";
import { llmComplete } from "@/lib/server/generate";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

interface PageRewrite {
  headline: string;
  metaDescription: string;
  intro: string;
  outline: string[];
  cta: string;
}

const REWRITE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    metaDescription: { type: "string" },
    intro: { type: "string" },
    outline: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
  },
  required: ["headline", "metaDescription", "intro", "outline", "cta"],
} as const;

/**
 * Deep per-page rewrite for audit buyers: re-fetches the live page and asks
 * the flagship model for a ready-to-paste headline, meta description, intro,
 * section outline, and CTA. Cached against the page's current content, so a
 * page that hasn't changed never pays for a second generation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`rewrite:${user.email}`, 15, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const audit = getSiteAudit(user.email, id);
  if (!audit || !audit.report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const url = String((body as Record<string, unknown>)?.url ?? "").trim();

  // Only pages that were part of the purchased crawl can be rewritten.
  const full = JSON.parse(audit.report) as { report?: { pages?: { url: string }[] } };
  const audited = (full.report?.pages ?? []).some((p) => p.url === url);
  if (!url || !audited) {
    return NextResponse.json({ error: "That page isn't part of this audit." }, { status: 400 });
  }

  const page = await fetchPageCheck(url);
  if (!page) {
    return NextResponse.json(
      { error: "We couldn't fetch that page right now — try again shortly." },
      { status: 502 }
    );
  }

  const cacheId = `rewrite:${id}:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
  const contentHash = createHash("sha256")
    .update(`${page.title}|${page.h1}|${page.text}`)
    .digest("hex");
  const cached = getContentTranslation(cacheId, "en", contentHash);
  if (cached) {
    return NextResponse.json({ rewrite: JSON.parse(cached) as PageRewrite, cached: true });
  }

  const res = await llmComplete(
    "You are a senior conversion copywriter and content strategist. You rewrite underperforming web pages so they hook readers, earn search clicks, and get cited by AI assistants. Write ready-to-paste copy in the site's own voice — concrete, specific, zero filler. Never invent statistics, testimonials, or claims not supported by the page's own content.",
    [
      `Rewrite the key copy of this page.`,
      `URL: ${page.url}`,
      `Current title: ${page.title || "(none)"}`,
      `Current H1: ${page.h1 || "(none)"}`,
      `Current word count: ${page.wordCount}`,
      `Page text (truncated):\n${page.text}`,
      ``,
      `Return JSON with exactly these keys:`,
      `- headline: a stronger H1 (under 70 characters, keeps the page's true topic and search intent)`,
      `- metaDescription: 140-155 characters, specific benefit + reason to click`,
      `- intro: a 2-3 sentence opening that states who the page is for and the payoff`,
      `- outline: 4-7 section headings (strings) forming a stronger structure for this page`,
      `- cta: one closing call-to-action sentence true to what the site actually offers`,
    ].join("\n"),
    REWRITE_SCHEMA as unknown as Record<string, unknown>,
    { tier: "flagship", maxTokens: 2000, context: "site-audit-rewrite" }
  );
  if (!res) {
    return NextResponse.json(
      { error: "The rewrite engine is unavailable right now — try again shortly." },
      { status: 503 }
    );
  }

  let rewrite: PageRewrite;
  try {
    rewrite = JSON.parse(res.text) as PageRewrite;
    if (!rewrite.headline || !Array.isArray(rewrite.outline)) throw new Error("shape");
  } catch {
    return NextResponse.json(
      { error: "The rewrite came back malformed — try again." },
      { status: 502 }
    );
  }

  setContentTranslation(cacheId, "en", contentHash, JSON.stringify(rewrite));
  return NextResponse.json({ rewrite, cached: false, engine: res.engine });
}

import { NextRequest, NextResponse } from "next/server";
import { getRealSessionUser } from "@/lib/server/auth";
import { decryptSecret, getSiteAudit, getWpConnection, insertAudit } from "@/lib/server/db";
import { applyWpFix, findWpItem } from "@/lib/server/wordpress";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

interface ApplyResult {
  url: string;
  status: "applied" | "not_found" | "failed";
  error?: string;
  /** What the page said before — paste back to undo. */
  previous?: { title: string; excerpt: string };
}

/**
 * One-click apply: push the audit's ready-to-paste page fixes (title +
 * meta description) into the buyer's connected WordPress site.
 * Honest scope: core REST updates the TITLE and EXCERPT; plugin-owned SEO
 * meta fields are not touched — the UI says exactly that.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`wp-apply:${user.email}`, 10, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const audit = getSiteAudit(user.email, id);
  if (!audit || !audit.report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conn = getWpConnection(user.email);
  if (!conn) {
    return NextResponse.json(
      { error: "Connect your WordPress site in Settings first." },
      { status: 400 }
    );
  }

  let only: string[] | null = null;
  try {
    const body = (await req.json()) as { urls?: unknown };
    if (Array.isArray(body?.urls)) only = body.urls.map(String);
  } catch {
    /* no body = apply all fixes */
  }

  const full = JSON.parse(audit.report) as {
    coach?: { pageFixes?: { url: string; title: string; metaDescription: string }[] };
  };
  const fixes = (full.coach?.pageFixes ?? []).filter(
    (f) => f.url && (only === null || only.includes(f.url))
  );
  if (!fixes.length) {
    return NextResponse.json({ error: "This report has no page fixes to apply." }, { status: 400 });
  }

  const appPassword = decryptSecret(conn.secretEnc);
  const results: ApplyResult[] = [];
  for (const fix of fixes.slice(0, 30)) {
    const item = await findWpItem(conn.siteUrl, conn.username, appPassword, fix.url);
    if (!item) {
      results.push({
        url: fix.url,
        status: "not_found",
        error: "No page or post with this slug on the connected site.",
      });
      continue;
    }
    const applied = await applyWpFix(conn.siteUrl, conn.username, appPassword, item, {
      title: fix.title || undefined,
      excerpt: fix.metaDescription || undefined,
    });
    results.push(
      applied.ok
        ? { url: fix.url, status: "applied", previous: applied.previous }
        : { url: fix.url, status: "failed", error: applied.error }
    );
  }

  const appliedCount = results.filter((r) => r.status === "applied").length;
  insertAudit(user.email, "wordpress.apply", `${id}: ${appliedCount}/${results.length} fixes → ${conn.siteUrl}`);
  return NextResponse.json({ results, applied: appliedCount });
}

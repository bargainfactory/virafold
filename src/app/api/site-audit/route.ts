import { NextRequest, NextResponse } from "next/server";
import { getRealSessionUser, isAdminEmail } from "@/lib/server/auth";
import { insertAudit, insertSiteAudit, listSiteAudits } from "@/lib/server/db";
import { resolveField } from "@/lib/server/integrations";
import { publicOrigin } from "@/lib/server/base-url";
import { kickSiteAuditWorker } from "@/lib/server/site-audit";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const AUDIT_PRICE_CENTS = 4900;

/** The buyer's own audits (drives the dashboard/report views). */
export async function GET() {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ audits: listSiteAudits(user.email) });
}

/**
 * Start a Complete Content Audit purchase: creates the audit record, then
 * hands back a Stripe Checkout URL. Payment (webhook) queues the crawl.
 * Without a Stripe key the product is visible but honestly not sellable yet
 * ({demo:true}); operators skip payment so fulfillment stays testable.
 */
export async function POST(req: NextRequest) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`site-audit:${user.email}`, 5, 60 * 60 * 1000);
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
  if (!url) return NextResponse.json({ error: "A website URL is required" }, { status: 400 });

  const id = `sa-${crypto.randomUUID()}`;

  // Operators run audits without payment — that's how fulfillment is tested
  // (and how a make-good is issued) before and after Stripe goes live.
  if (isAdminEmail(user.email)) {
    insertSiteAudit(user.email, id, url, { paid: true });
    insertAudit(user.email, "site_audit.operator", `${id} ${url}`);
    kickSiteAuditWorker();
    return NextResponse.json({ id, operator: true }, { status: 201 });
  }

  const secretKey = resolveField("stripe", "secretKey");
  if (!secretKey) {
    return NextResponse.json({ demo: true, error: "Payments aren't live quite yet — the Complete Audit launches soon." });
  }

  insertSiteAudit(user.email, id, url);
  const origin = publicOrigin(req);
  const params = new URLSearchParams({
    mode: "payment",
    customer_email: user.email,
    success_url: `${origin}/site-audit/${id}`,
    cancel_url: `${origin}/tools/website-score`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(AUDIT_PRICE_CENTS),
    "line_items[0][price_data][product_data][name]": "Virafold Complete Content Audit",
    "line_items[0][price_data][product_data][description]": `Full-site crawl and AI action plan for ${url}`,
    "metadata[siteAuditId]": id,
  });
  try {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.url) {
      return NextResponse.json({ error: "Checkout could not be started — try again shortly" }, { status: 502 });
    }
    return NextResponse.json({ id, checkoutUrl: String(data.url) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not reach the payment provider" }, { status: 502 });
  }
}

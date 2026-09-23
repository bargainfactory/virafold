import { NextRequest, NextResponse } from "next/server";
import { getRealSessionUser, isAdminEmail } from "@/lib/server/auth";
import { addAuditCredits, addBonusProjects, getUserCredits, insertAudit } from "@/lib/server/db";
import { resolveField } from "@/lib/server/integrations";
import { publicOrigin } from "@/lib/server/base-url";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** One-off packs sold on the pricing page. Prices here are authoritative for
 *  checkout; the pricing page reads the same numbers from DEFAULT_PRICING. */
const PACKS: Record<string, { name: string; description: string; cents: number }> = {
  auditPack: {
    name: "Virafold Agency Audit Pack",
    description: "10 Complete Content Audit credits for client sites",
    cents: 34900,
  },
  episodeKit: {
    name: "Virafold Podcast Episode Kit",
    description: "One bonus project: one episode → clips, chapters, notes, newsletter",
    cents: 2900,
  },
};

/** Current balances, so the UI can show what a signed-in user already owns. */
export async function GET() {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(getUserCredits(user.email));
}

export async function POST(req: NextRequest) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`pack:${user.email}`, 10, 60 * 60 * 1000);
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
  const packId = String((body as Record<string, unknown>)?.pack ?? "");
  const pack = PACKS[packId];
  if (!pack) return NextResponse.json({ error: "Unknown pack" }, { status: 400 });

  // Operators get the grant directly — that's how fulfillment is tested
  // before and after Stripe goes live.
  if (isAdminEmail(user.email)) {
    if (packId === "auditPack") addAuditCredits(user.email, 10);
    else addBonusProjects(user.email, 1);
    insertAudit(user.email, "pack.operator", packId);
    return NextResponse.json({ granted: true, operator: true }, { status: 201 });
  }

  const secretKey = resolveField("stripe", "secretKey");
  if (!secretKey) {
    return NextResponse.json({ demo: true, error: "Payments aren't live quite yet — one-off packs launch soon." });
  }

  const origin = publicOrigin(req);
  const params = new URLSearchParams({
    mode: "payment",
    customer_email: user.email,
    success_url: `${origin}/dashboard`,
    cancel_url: `${origin}/#pricing`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.cents),
    "line_items[0][price_data][product_data][name]": pack.name,
    "line_items[0][price_data][product_data][description]": pack.description,
    "metadata[pack]": packId,
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
    return NextResponse.json({ checkoutUrl: String(data.url) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not reach the payment provider" }, { status: 502 });
  }
}

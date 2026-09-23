import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  findUser,
  insertAudit,
  insertNotification,
  setPendingPlan,
  setUserPlan,
} from "@/lib/server/db";
import { resolveField } from "@/lib/server/integrations";
import { PRICE_ID_TO_PLAN } from "@/lib/server/pricing";

export const dynamic = "force-dynamic";

// Stripe retries failed deliveries for days; reject events older than this so
// a replayed capture can't be used long after the fact.
const TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Verifies Stripe's `stripe-signature` header (t=...,v1=...) against the raw
 * body: v1 = HMAC-SHA256(webhookSecret, `${t}.${payload}`).
 */
function verifySignature(payload: string, header: string, secret: string): boolean {
  const parts = new Map<string, string[]>();
  for (const kv of header.split(",")) {
    const [k, v] = kv.split("=", 2);
    if (!k || !v) continue;
    const list = parts.get(k.trim()) ?? [];
    list.push(v.trim());
    parts.set(k.trim(), list);
  }
  const t = parts.get("t")?.[0];
  const sigs = parts.get("v1") ?? [];
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Date.now() - Number(t) * 1000) > TOLERANCE_MS) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return sigs.some((sig) => {
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
    } catch {
      return false;
    }
  });
}

function applyPlan(email: string, plan: string, source: string): void {
  if (findUser(email)) {
    setUserPlan(email, plan);
    insertNotification(email, {
      id: `n-${crypto.randomUUID()}`,
      title: "Plan Updated",
      message: `Your account is now on the ${plan} plan. Welcome aboard!`,
      time: "Just now",
      read: false,
      type: "success",
    });
  } else {
    // Paid before creating an account — the plan attaches at signup.
    setPendingPlan(email, plan);
  }
  insertAudit("stripe-webhook", "plan.sync", `${email} → ${plan} (${source})`);
}

export async function POST(req: NextRequest) {
  const webhookSecret = resolveField("stripe", "webhookSecret");
  if (!webhookSecret) {
    // Unverifiable events must never mutate plans. 503 tells Stripe to retry
    // (in case the secret is being rotated) without acknowledging anything.
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  if (!verifySignature(payload, signature, webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const type = String(event.type ?? "");
  const obj = ((event.data as Record<string, unknown>)?.object ?? {}) as Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >;

  if (type === "checkout.session.completed") {
    const email = String(
      obj.customer_details?.email ?? obj.customer_email ?? ""
    ).toLowerCase();
    const priceId = String(obj.metadata?.priceId ?? obj.client_reference_id ?? "");
    const plan = PRICE_ID_TO_PLAN[priceId];
    if (email && plan) applyPlan(email, plan, "checkout.session.completed");

    // One-off packs: payment grants credits usable at each feature's gate.
    const pack = String(obj.metadata?.pack ?? "");
    if (email && pack === "auditPack") {
      const { addAuditCredits } = await import("@/lib/server/db");
      addAuditCredits(email, 10);
      insertNotification(email, {
        id: `n-${crypto.randomUUID()}`,
        title: "Agency Audit Pack activated",
        message: "10 audit credits added — run a Complete Content Audit on any client site, no per-audit checkout.",
        time: "Just now",
        read: false,
        type: "success",
      });
      insertAudit("stripe-webhook", "pack.audit10", email);
    } else if (email && pack === "episodeKit") {
      const { addBonusProjects } = await import("@/lib/server/db");
      addBonusProjects(email, 1);
      insertNotification(email, {
        id: `n-${crypto.randomUUID()}`,
        title: "Podcast Episode Kit activated",
        message: "One bonus project added — upload your episode and it won't count against your monthly plan quota.",
        time: "Just now",
        read: false,
        type: "success",
      });
      insertAudit("stripe-webhook", "pack.episodeKit", email);
    }

    // One-off Complete Content Audit: payment unlocks and queues the crawl.
    const siteAuditId = String(obj.metadata?.siteAuditId ?? "");
    if (siteAuditId) {
      const { markSiteAuditPaid } = await import("@/lib/server/db");
      const { kickSiteAuditWorker } = await import("@/lib/server/site-audit");
      const audit = markSiteAuditPaid(siteAuditId);
      if (audit) {
        insertAudit("stripe-webhook", "site_audit.paid", `${siteAuditId} ${audit.url}`);
        kickSiteAuditWorker();
      }
    }
  } else if (type === "customer.subscription.deleted") {
    // The subscription object carries a customer id, not an email — resolve it.
    const secretKey = resolveField("stripe", "secretKey");
    const customerId = String(obj.customer ?? "");
    if (secretKey && customerId) {
      try {
        const resp = await fetch(
          `https://api.stripe.com/v1/customers/${customerId}`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        if (resp.ok) {
          const customer = await resp.json();
          const email = String(customer?.email ?? "").toLowerCase();
          if (email && findUser(email)) applyPlan(email, "Free", type);
        }
      } catch {
        /* leave the plan untouched rather than guess */
      }
    }
  }

  // Acknowledge everything verifiable — unhandled event types included — so
  // Stripe doesn't retry events this app deliberately ignores.
  return NextResponse.json({ received: true });
}

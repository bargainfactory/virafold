import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getRealSessionUser } from "@/lib/server/auth";
import {
  bestPlanFor,
  deleteSiteMonitor,
  getMonitorHistory,
  insertEvent,
  insertSiteMonitor,
  listSiteMonitors,
} from "@/lib/server/db";
import { MONITOR_CAPS, runSiteMonitors } from "@/lib/server/site-monitor";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Site Monitor: weekly automatic re-scores with drop alerts (paid plans). */

export async function GET() {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = bestPlanFor(user.email);
  const cap = MONITOR_CAPS[plan] ?? 0;
  const monitors = listSiteMonitors(user.email).map((m) => ({
    id: m.id,
    url: m.url,
    lastScore: m.lastScore,
    lastCheckedAt: m.lastCheckedAt,
    history: getMonitorHistory(m.id, 12),
  }));
  return NextResponse.json({ monitors, cap, plan });
}

export async function POST(req: NextRequest) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`monitor:${user.email}`, 10, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const plan = bestPlanFor(user.email);
  const cap = MONITOR_CAPS[plan] ?? 0;
  if (cap === 0) {
    return NextResponse.json(
      { error: "Site Monitor is available on paid plans — upgrade to add weekly checks." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const raw = String((body as Record<string, unknown>)?.url ?? "").trim();
  if (!raw || raw.length > 300) {
    return NextResponse.json({ error: "Enter a valid site URL" }, { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return NextResponse.json({ error: "Enter a valid site URL" }, { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) {
    return NextResponse.json({ error: "Enter a valid site URL" }, { status: 400 });
  }

  const existing = listSiteMonitors(user.email);
  if (existing.length >= cap) {
    return NextResponse.json(
      { error: `Your ${plan} plan includes ${cap} monitored site${cap === 1 ? "" : "s"}. Remove one or upgrade to add more.` },
      { status: 403 }
    );
  }
  const normalized = `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  if (existing.some((m) => m.url === normalized)) {
    return NextResponse.json({ error: "You're already monitoring that site." }, { status: 409 });
  }

  const id = `mon-${crypto.randomUUID()}`;
  insertSiteMonitor(user.email, id, normalized);
  insertEvent("site_monitor_add", normalized, plan);
  // Baseline score right away — new monitors sort first in the due list.
  try {
    runSiteMonitors();
  } catch {
    /* baseline will run on the next scheduler pass */
  }
  return NextResponse.json({ id, url: normalized });
}

export async function DELETE(req: NextRequest) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  deleteSiteMonitor(user.email, id);
  return NextResponse.json({ ok: true });
}

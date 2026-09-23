import { NextRequest, NextResponse } from "next/server";
import { getRealSessionUser } from "@/lib/server/auth";
import {
  deleteWpConnection,
  encryptSecret,
  getWpConnection,
  insertAudit,
  setWpConnection,
} from "@/lib/server/db";
import { normalizeWpSiteUrl, verifyWpConnection } from "@/lib/server/wordpress";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Connection status — never returns the stored secret. */
export async function GET() {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const conn = getWpConnection(user.email);
  return NextResponse.json(
    conn ? { connected: true, siteUrl: conn.siteUrl, username: conn.username } : { connected: false }
  );
}

/** Connect: verify the Application Password against the live site, then store
 *  it encrypted (same AES-256-GCM envelope as operator integrations). */
export async function POST(req: NextRequest) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`wp-connect:${user.email}`, 10, 60 * 60 * 1000);
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
  const b = body as Record<string, unknown>;
  const siteUrl = normalizeWpSiteUrl(String(b?.siteUrl ?? ""));
  const username = String(b?.username ?? "").trim().slice(0, 120);
  const appPassword = String(b?.appPassword ?? "").trim().slice(0, 200);
  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json(
      { error: "Site URL, username, and an Application Password are required." },
      { status: 400 }
    );
  }

  const check = await verifyWpConnection(siteUrl, username, appPassword);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  setWpConnection(user.email, siteUrl, username, encryptSecret(appPassword));
  insertAudit(user.email, "wordpress.connect", siteUrl);
  return NextResponse.json({ connected: true, siteUrl, username, name: check.name });
}

export async function DELETE() {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  deleteWpConnection(user.email);
  insertAudit(user.email, "wordpress.disconnect", "");
  return NextResponse.json({ connected: false });
}

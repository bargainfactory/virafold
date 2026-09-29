import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getRealSessionUser } from "@/lib/server/auth";
import { isEmailVerified, setVerifyToken } from "@/lib/server/db";
import { emailConfigured, sendEmail } from "@/lib/server/email";
import { publicOrigin } from "@/lib/server/base-url";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isEmailVerified(user.email)) return NextResponse.json({ ok: true, already: true });
  if (!emailConfigured()) {
    return NextResponse.json({ error: "Email delivery is not configured yet" }, { status: 503 });
  }

  const gate = rateLimit(`verify-resend:${user.email}`, 3, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  setVerifyToken(user.email, token);
  const link = `${publicOrigin(req)}/api/auth/verify?token=${token}`;
  const r = await sendEmail({
    to: user.email,
    subject: "Verify your Virafold email",
    // No user-supplied content here — the name field has been abused as a
    // spam carrier in verification mails.
    html: `<p>Confirm this email address for your Virafold account:</p><p><a href="${link}">Verify my email</a></p><p>If you didn't create this account, you can ignore this message.</p>`,
  });
  if (!r.sent) {
    return NextResponse.json({ error: "Could not send the email — try again shortly" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

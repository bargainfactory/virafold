import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  hashPassword,
  initialsFor,
} from "@/lib/auth/session";
import {
  consumePendingPlan,
  createUser,
  findUser,
  getReferralInfo,
  seedUser,
  setReferredBy,
  setVerifyToken,
} from "@/lib/server/db";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { emailConfigured, sendEmail } from "@/lib/server/email";
import { publicOrigin } from "@/lib/server/base-url";
import { randomUUID } from "node:crypto";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  // Throttle per-IP so the "email already exists" response can't be used to
  // enumerate accounts at scale, and to blunt automated signup abuse.
  const gate = rateLimit(`signup:${clientIp(req)}`, 10, 15 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
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
  const name = String(b?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const email = String(b?.email ?? "").trim().toLowerCase();
  const password = String(b?.password ?? "");

  // Honeypot: a hidden field humans never see. Bots that fill it get a
  // success-shaped response and no account — let them believe it worked.
  if (String(b?.company ?? "").trim()) {
    return NextResponse.json({ user: { name, email } });
  }

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  // Names carrying URLs are spam using our verification email as a relay
  // (seen in the wild: casino links in the name field).
  if (/https?:|www\.|bit\.ly|tinyurl|t\.me|t\.co\/|[a-z0-9-]+\.[a-z]{2,}\//i.test(name)) {
    return NextResponse.json({ error: "Name can't contain links" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  if (password.length < 8)
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );

  if (findUser(email)) {
    return NextResponse.json(
      { error: "An account with that email already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  // A Stripe checkout completed before signup reserves a plan for this email.
  const plan = consumePendingPlan(email) ?? "Free";
  createUser({
    email,
    name,
    passwordHash,
    plan,
    createdAt: new Date().toISOString(),
  });
  seedUser(email);
  // Mint this account's referral code, and credit the referrer if the signup
  // arrived through a ?ref= link.
  getReferralInfo(email);
  const ref = String(b?.ref ?? "").trim();
  if (ref) setReferredBy(email, ref);

  // Email verification rides the email rail: with Resend configured, the
  // account starts unverified and gets a confirmation link. Without it
  // (self-hosted, no key) accounts stay verified so nothing blocks.
  if (emailConfigured()) {
    const verifyToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    setVerifyToken(email, verifyToken);
    const link = `${publicOrigin(req)}/api/auth/verify?token=${verifyToken}`;
    void sendEmail({
      to: email,
      subject: "Verify your Virafold email",
      // Deliberately no user-supplied content in this email — the name field
      // was being used to smuggle spam into verification mails.
      html: `<p>Welcome to Virafold! Confirm this email address to secure your account:</p><p><a href="${link}">Verify my email</a></p><p>If you didn't create this account, you can ignore this message.</p>`,
    });
  }

  const user = { name, email, initials: initialsFor(name), plan };
  const token = await createSessionToken(user);

  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

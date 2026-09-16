import type { NextRequest } from "next/server";

const CANONICAL = "https://virafold.ai";

/**
 * Public origin for URLs we hand out (share links, OAuth redirects, Stripe
 * return URLs). Behind the reverse proxy req.nextUrl.origin resolves to
 * localhost:3000, so production always uses the canonical domain
 * (overridable via PUBLIC_BASE_URL); dev keeps the local origin.
 */
export function publicOrigin(req: NextRequest): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.NODE_ENV === "production") return CANONICAL;
  return req.nextUrl.origin;
}

/** Same resolution for contexts with no request (workers, scheduled jobs). */
export function publicOriginStatic(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.NODE_ENV === "production") return CANONICAL;
  return "http://localhost:3000";
}

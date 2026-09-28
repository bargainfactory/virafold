import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import {
  CONNECTABLE,
  authorizeUrl,
  makePkce,
  makeState,
  platformCreds,
  type ConnectablePlatform,
} from "@/lib/server/connect";
import { publicOrigin } from "@/lib/server/base-url";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const user = await getSessionUser();
  // req.url is localhost behind Caddy — build browser redirects on the public origin.
  if (!user) return NextResponse.redirect(new URL("/login", publicOrigin(_req)));

  const { platform } = await params;
  if (!(CONNECTABLE as readonly string[]).includes(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }
  const p = platform as ConnectablePlatform;
  const creds = platformCreds(p);
  if (!creds) {
    return NextResponse.json(
      { error: "This platform's app credentials are not configured yet" },
      { status: 503 }
    );
  }

  const state = makeState();
  const pkce = p === "x" ? makePkce() : undefined;
  const res = NextResponse.redirect(
    authorizeUrl(p, creds.clientId, state, pkce?.challenge)
  );
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set(`vf_oauth_state_${p}`, state, cookieOpts);
  if (pkce) res.cookies.set(`vf_oauth_verifier_${p}`, pkce.verifier, cookieOpts);
  return res;
}

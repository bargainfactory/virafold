/**
 * Creator platform connections (OAuth 2.0) + real content delivery.
 *
 * X uses OAuth 2.0 + PKCE (S256) with refresh tokens; LinkedIn uses the
 * standard authorization-code flow; YouTube uses Google OAuth (offline access,
 * reusing the google-oauth app credentials unless dedicated ones are set);
 * TikTok uses its v2 OAuth with client_key semantics. Operator app credentials
 * come from the "publishing" integration; each creator connects their own
 * account, and tokens live per-user in platform_accounts.
 *
 * Delivery: text posts to X and LinkedIn, rendered video uploads to YouTube
 * (Shorts) and TikTok. Every successful delivery returns the platform-side id
 * so the metrics poller can read real performance back.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { resolveField } from "./integrations";
import {
  getPlatformAccount,
  upsertPlatformAccount,
  type PlatformAccount,
} from "./db";

export const CONNECTABLE = ["x", "linkedin", "youtube", "tiktok"] as const;
export type ConnectablePlatform = (typeof CONNECTABLE)[number];

const BASE_URL = process.env.PUBLIC_BASE_URL || "https://virafold.ai";

export function redirectUri(platform: ConnectablePlatform): string {
  return `${BASE_URL}/api/connect/${platform}/callback`;
}

export function platformCreds(
  platform: ConnectablePlatform
): { clientId: string; clientSecret: string } | null {
  let clientId: string | null | undefined;
  let clientSecret: string | null | undefined;
  switch (platform) {
    case "x":
      clientId = resolveField("publishing", "xClientId");
      clientSecret = resolveField("publishing", "xClientSecret");
      break;
    case "linkedin":
      clientId = resolveField("publishing", "linkedinClientId");
      clientSecret = resolveField("publishing", "linkedinClientSecret");
      break;
    case "youtube":
      // Dedicated fields win; otherwise the Google login app works as-is once
      // the YouTube Data API is enabled on the same Google Cloud project.
      clientId =
        resolveField("publishing", "youtubeClientId") ||
        resolveField("google-oauth", "clientId");
      clientSecret =
        resolveField("publishing", "youtubeClientSecret") ||
        resolveField("google-oauth", "clientSecret");
      break;
    case "tiktok":
      clientId = resolveField("publishing", "tiktokClientKey");
      clientSecret = resolveField("publishing", "tiktokClientSecret");
      break;
  }
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function makeState(): string {
  return randomBytes(16).toString("hex");
}

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(
  platform: ConnectablePlatform,
  clientId: string,
  state: string,
  pkceChallenge?: string
): string {
  if (platform === "x") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri("x"),
      scope: "tweet.read tweet.write users.read offline.access",
      state,
      code_challenge: pkceChallenge ?? "",
      code_challenge_method: "S256",
    });
    return `https://twitter.com/i/oauth2/authorize?${p.toString()}`;
  }
  if (platform === "youtube") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri("youtube"),
      scope:
        "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      state,
      access_type: "offline",
      prompt: "consent",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
  }
  if (platform === "tiktok") {
    const p = new URLSearchParams({
      client_key: clientId,
      response_type: "code",
      scope: "user.info.basic,video.publish",
      redirect_uri: redirectUri("tiktok"),
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${p.toString()}`;
  }
  const p = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri("linkedin"),
    scope: "openid profile w_member_social",
    state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
}

async function form(url: string, params: Record<string, string>, basicAuth?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (basicAuth) headers.Authorization = `Basic ${basicAuth}`;
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });
  if (!resp.ok) throw new Error(`${url} -> ${resp.status}: ${await resp.text()}`);
  return (await resp.json()) as TokenResponse;
}

/** Exchange the authorization code, fetch identity, persist the connection. */
export async function completeConnection(
  email: string,
  platform: ConnectablePlatform,
  code: string,
  pkceVerifier?: string
): Promise<{ handle: string | null }> {
  const creds = platformCreds(platform);
  if (!creds) throw new Error("publishing app not configured");

  if (platform === "x") {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const tok = await form(
      "https://api.twitter.com/2/oauth2/token",
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri("x"),
        code_verifier: pkceVerifier ?? "",
        client_id: creds.clientId,
      },
      basic
    );
    let externalId: string | null = null;
    let handle: string | null = null;
    try {
      const me = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      }).then((r) => (r.ok ? r.json() : null));
      externalId = me?.data?.id ?? null;
      handle = me?.data?.username ? `@${me.data.username}` : null;
    } catch {
      /* identity is cosmetic; the connection still works */
    }
    upsertPlatformAccount(email, {
      platform: "x",
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
      externalId,
      handle,
    });
    return { handle };
  }

  if (platform === "youtube") {
    const tok = await form("https://oauth2.googleapis.com/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri("youtube"),
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    let externalId: string | null = null;
    let handle: string | null = null;
    try {
      const me = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${tok.access_token}` } }
      ).then((r) => (r.ok ? r.json() : null));
      externalId = me?.items?.[0]?.id ?? null;
      handle = me?.items?.[0]?.snippet?.title ?? null;
    } catch {
      /* identity is cosmetic */
    }
    upsertPlatformAccount(email, {
      platform: "youtube",
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
      externalId,
      handle,
    });
    return { handle };
  }

  if (platform === "tiktok") {
    const tok = await form("https://open.tiktokapis.com/v2/oauth/token/", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri("tiktok"),
      client_key: creds.clientId,
      client_secret: creds.clientSecret,
    });
    let handle: string | null = null;
    try {
      const me = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
        { headers: { Authorization: `Bearer ${tok.access_token}` } }
      ).then((r) => (r.ok ? r.json() : null));
      handle = me?.data?.user?.display_name ?? null;
    } catch {
      /* identity is cosmetic */
    }
    upsertPlatformAccount(email, {
      platform: "tiktok",
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
      externalId: tok.open_id ?? null,
      handle,
    });
    return { handle };
  }

  const tok = await form("https://www.linkedin.com/oauth/v2/accessToken", {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri("linkedin"),
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  let externalId: string | null = null;
  let handle: string | null = null;
  try {
    const me = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }).then((r) => (r.ok ? r.json() : null));
    externalId = me?.sub ?? null;
    handle = me?.name ?? null;
  } catch {
    /* identity is cosmetic */
  }
  upsertPlatformAccount(email, {
    platform: "linkedin",
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? null,
    expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
    externalId,
    handle,
  });
  return { handle };
}

/** Returns a currently-valid access token, refreshing where the platform
 *  supports it (X, YouTube, TikTok). */
export async function freshToken(
  email: string,
  acct: PlatformAccount
): Promise<string | null> {
  const stale = acct.expiresAt !== null && acct.expiresAt < Date.now() + 60_000;
  if (!stale) return acct.accessToken;
  if (!acct.refreshToken) return null;

  const platform = acct.platform as ConnectablePlatform;
  const creds = platformCreds(platform);
  if (!creds) return null;
  try {
    let tok: TokenResponse;
    if (platform === "x") {
      const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
      tok = await form(
        "https://api.twitter.com/2/oauth2/token",
        {
          grant_type: "refresh_token",
          refresh_token: acct.refreshToken,
          client_id: creds.clientId,
        },
        basic
      );
    } else if (platform === "youtube") {
      tok = await form("https://oauth2.googleapis.com/token", {
        grant_type: "refresh_token",
        refresh_token: acct.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });
    } else if (platform === "tiktok") {
      tok = await form("https://open.tiktokapis.com/v2/oauth/token/", {
        grant_type: "refresh_token",
        refresh_token: acct.refreshToken,
        client_key: creds.clientId,
        client_secret: creds.clientSecret,
      });
    } else {
      return null; // LinkedIn tokens are not refreshable in this flow
    }
    upsertPlatformAccount(email, {
      ...acct,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? acct.refreshToken,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
    });
    return tok.access_token;
  } catch {
    return null;
  }
}

export interface DeliveryResult {
  ok: boolean;
  detail: string;
  externalId?: string;
}

/**
 * Posts asset text to the creator's connected account. Returns null when no
 * usable connection exists (caller falls back to demo publish), otherwise a
 * success flag plus an error detail for honest notifications.
 */
export async function deliverPost(
  email: string,
  platform: string,
  text: string
): Promise<DeliveryResult | null> {
  const key = platform.toLowerCase() === "x" ? "x" : platform.toLowerCase();
  if (key !== "x" && key !== "linkedin") return null;
  const acct = getPlatformAccount(email, key);
  if (!acct) return null;
  const token = await freshToken(email, acct);
  if (!token) return { ok: false, detail: "token expired — reconnect the account" };

  try {
    if (key === "x") {
      const resp = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: text.slice(0, 280) }),
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        return { ok: true, detail: "posted to X", externalId: data?.data?.id ?? undefined };
      }
      return { ok: false, detail: `X API ${resp.status}` };
    }

    if (!acct.externalId) return { ok: false, detail: "missing LinkedIn member id — reconnect" };
    const resp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: `urn:li:person:${acct.externalId}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: text.slice(0, 2900) },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
    if (resp.ok) {
      return {
        ok: true,
        detail: "posted to LinkedIn",
        externalId: resp.headers.get("x-restli-id") ?? undefined,
      };
    }
    return { ok: false, detail: `LinkedIn API ${resp.status}` };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 120) };
  }
}

/**
 * Uploads a rendered clip to the creator's connected video platform.
 * YouTube: resumable upload published as a Short. TikTok: v2 direct post —
 * uploaded as private (SELF_ONLY) because TikTok only allows public posting
 * for audited apps; the creator flips it public in the TikTok app.
 * Returns null when the platform has no usable connection.
 */
export async function deliverVideo(
  email: string,
  platform: string,
  filePath: string,
  title: string,
  description: string,
  /** false for long-form (ambient loops) — no #Shorts tag. */
  isShort = true
): Promise<DeliveryResult | null> {
  const key = platform.toLowerCase();
  if (key !== "youtube" && key !== "tiktok") return null;
  const acct = getPlatformAccount(email, key);
  if (!acct) return null;
  const token = await freshToken(email, acct);
  if (!token) return { ok: false, detail: "token expired — reconnect the account" };

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    return { ok: false, detail: "rendered clip file is missing on disk" };
  }

  try {
    if (key === "youtube") {
      const ytTitle = !isShort
        ? title.slice(0, 100)
        : /#shorts/i.test(title)
          ? title.slice(0, 100)
          : `${title.slice(0, 90)} #Shorts`;
      const init = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": String(bytes.length),
          },
          body: JSON.stringify({
            snippet: { title: ytTitle, description: description.slice(0, 4900), categoryId: "22" },
            status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
          }),
        }
      );
      if (!init.ok) return { ok: false, detail: `YouTube init ${init.status}` };
      const uploadUrl = init.headers.get("location");
      if (!uploadUrl) return { ok: false, detail: "YouTube gave no upload URL" };
      const up = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) },
        body: new Uint8Array(bytes),
      });
      if (!up.ok) return { ok: false, detail: `YouTube upload ${up.status}` };
      const data = await up.json().catch(() => null);
      return {
        ok: true,
        detail: "uploaded to YouTube as a Short",
        externalId: data?.id ?? undefined,
      };
    }

    // TikTok direct post (v2). Unaudited apps may only create SELF_ONLY posts.
    const init = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: { title: title.slice(0, 150), privacy_level: "SELF_ONLY" },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: bytes.length,
          chunk_size: bytes.length,
          total_chunk_count: 1,
        },
      }),
    });
    if (!init.ok) return { ok: false, detail: `TikTok init ${init.status}` };
    const initData = await init.json().catch(() => null);
    const uploadUrl: string | undefined = initData?.data?.upload_url;
    const publishId: string | undefined = initData?.data?.publish_id;
    if (!uploadUrl) return { ok: false, detail: "TikTok gave no upload URL" };
    const up = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      },
      body: new Uint8Array(bytes),
    });
    if (!up.ok) return { ok: false, detail: `TikTok upload ${up.status}` };
    return {
      ok: true,
      detail: "uploaded to TikTok (as private — approve it in the TikTok app)",
      externalId: publishId,
    };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 120) };
  }
}

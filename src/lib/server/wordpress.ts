/**
 * WordPress REST client for "apply my audit fixes with one click".
 *
 * Honest scope: WordPress core's REST API exposes a page/post's TITLE and
 * EXCERPT — those we can update. The SEO meta description most sites render
 * comes from a plugin (Yoast, RankMath, ...) whose fields core REST does not
 * expose without extra plugin setup, so we set the excerpt (which many themes
 * and plugins fall back to) and SAY SO in the UI rather than pretend.
 *
 * Auth is a WordPress Application Password (Users → Profile → Application
 * Passwords) sent as HTTP Basic — revocable per-app, never the real password.
 */

import { isBlockedHost } from "./website-score";

const TIMEOUT_MS = 12_000;

export function normalizeWpSiteUrl(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, "");
  if (!s || s.length > 300) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || isBlockedHost(u.hostname)) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

function basicAuth(username: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}

async function wpFetch(
  url: string,
  auth: string,
  init?: RequestInit
): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

/** Prove the credentials work and can edit content. */
export async function verifyWpConnection(
  siteUrl: string,
  username: string,
  appPassword: string
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const auth = basicAuth(username, appPassword);
  const res = await wpFetch(`${siteUrl}/wp-json/wp/v2/users/me?context=edit`, auth);
  if (!res) return { ok: false, error: "Could not reach the site — check the URL." };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "WordPress rejected the credentials — check the username and Application Password." };
  }
  if (!res.ok) {
    return { ok: false, error: `The site's REST API answered ${res.status} — is this a WordPress site with the REST API enabled?` };
  }
  const me = (await res.json().catch(() => null)) as { name?: string; capabilities?: Record<string, boolean> } | null;
  if (!me?.name) return { ok: false, error: "Unexpected reply from the site's REST API." };
  if (me.capabilities && !me.capabilities.edit_pages && !me.capabilities.edit_posts) {
    return { ok: false, error: `Connected as ${me.name}, but that user can't edit pages or posts.` };
  }
  return { ok: true, name: me.name };
}

export interface WpItem {
  kind: "pages" | "posts";
  id: number;
  title: string;
  excerpt: string;
  link: string;
}

/** Locate the page or post behind an audited URL by its slug. */
export async function findWpItem(
  siteUrl: string,
  username: string,
  appPassword: string,
  pageUrl: string
): Promise<WpItem | null> {
  let slug = "";
  try {
    const segs = new URL(pageUrl).pathname.split("/").filter(Boolean);
    slug = segs[segs.length - 1] ?? "";
  } catch {
    return null;
  }
  if (!slug) return null; // the homepage has no slug — front-page fixes stay manual
  const auth = basicAuth(username, appPassword);
  for (const kind of ["pages", "posts"] as const) {
    const res = await wpFetch(
      `${siteUrl}/wp-json/wp/v2/${kind}?slug=${encodeURIComponent(slug)}&context=edit`,
      auth
    );
    if (!res?.ok) continue;
    const list = (await res.json().catch(() => null)) as
      | { id: number; title?: { raw?: string; rendered?: string }; excerpt?: { raw?: string; rendered?: string }; link?: string }[]
      | null;
    const item = list?.[0];
    if (item?.id) {
      return {
        kind,
        id: item.id,
        title: item.title?.raw ?? item.title?.rendered ?? "",
        excerpt: item.excerpt?.raw ?? "",
        link: item.link ?? pageUrl,
      };
    }
  }
  return null;
}

/** Update title + excerpt on a found item. Returns the previous values for undo. */
export async function applyWpFix(
  siteUrl: string,
  username: string,
  appPassword: string,
  item: WpItem,
  fix: { title?: string; excerpt?: string }
): Promise<{ ok: true; previous: { title: string; excerpt: string } } | { ok: false; error: string }> {
  const payload: Record<string, string> = {};
  if (fix.title) payload.title = fix.title;
  if (fix.excerpt) payload.excerpt = fix.excerpt;
  if (!Object.keys(payload).length) return { ok: false, error: "Nothing to apply for this page." };
  const auth = basicAuth(username, appPassword);
  const res = await wpFetch(`${siteUrl}/wp-json/wp/v2/${item.kind}/${item.id}`, auth, {
    method: "POST", // WP REST accepts POST for updates; broadest host compatibility
    body: JSON.stringify(payload),
  });
  if (!res) return { ok: false, error: "Could not reach the site." };
  if (!res.ok) return { ok: false, error: `WordPress answered ${res.status} while updating.` };
  return { ok: true, previous: { title: item.title, excerpt: item.excerpt } };
}

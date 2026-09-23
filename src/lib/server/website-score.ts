/**
 * Website content score: crawl a site's public pages (sitemap-first, homepage
 * links as fallback) and grade it /100 across five sections — content depth,
 * headline strength, discovery basics, AI findability, and repurposing
 * potential. Deterministic end to end: the free tier costs nothing to serve,
 * and every point traces to a check the report names. The paid audit runs the
 * same analyzer wider and layers LLM coaching on top (site-audit.ts).
 */

import { scoreHook } from "./generate";

const PAGE_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_200_000;
const FETCH_CONCURRENCY = 4;
const UA = "VirafoldBot/1.0 (+https://virafold.ai/tools/website-score)";

/** Hosts that must never be fetched server-side (SSRF guard). */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === "0.0.0.0" ||
    h === "[::1]"
  );
}

export interface PageCheck {
  url: string;
  title: string;
  titleLen: number;
  hasMetaDesc: boolean;
  metaDescLen: number;
  h1: string;
  hasOg: boolean;
  hasJsonLd: boolean;
  wordCount: number;
  subheadings: number;
  hookScore: number; // scoreHook over the better of title/h1
  text: string; // stripped body text (trimmed) — fuel for the coach layer
}

export interface ScoreSection {
  key: string;
  label: string;
  score: number; // 0–20
  notes: string[];
}

export interface SiteScoreReport {
  url: string;
  fetchedPages: number;
  hasSitemap: boolean;
  hasRobots: boolean;
  hasLlmsTxt: boolean;
  hasRss: boolean;
  lastmod: string | null;
  sections: ScoreSection[];
  total: number; // 0–100
  grade: string; // A–F
  trappedPosts: number;
  trappedAssets: number;
  pages: Omit<PageCheck, "text">[];
}

function normalizeUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s || s.length > 300) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

async function fetchText(url: URL, timeoutMs = PAGE_TIMEOUT_MS): Promise<string | null> {
  return (await fetchPage(url, timeoutMs))?.html ?? null;
}

/** Fetch returning the FINAL post-redirect URL — a site that redirects to its
 *  www. host must be crawled at that host, or its whole sitemap gets filtered
 *  out as "cross-origin" (the bug that scored an 807-page site on 1 page). */
async function fetchPage(
  url: URL,
  timeoutMs = PAGE_TIMEOUT_MS
): Promise<{ html: string; finalUrl: URL } | null> {
  if (!/^https?:$/.test(url.protocol) || isBlockedHost(url.hostname)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    let finalUrl: URL;
    try {
      finalUrl = new URL(resp.url || url.href);
    } catch {
      finalUrl = url;
    }
    if (isBlockedHost(finalUrl.hostname)) return null;
    const text = await resp.text();
    return {
      html: text.length > MAX_HTML_BYTES ? text.slice(0, MAX_HTML_BYTES) : text,
      finalUrl,
    };
  } catch {
    return null;
  }
}

/** www.-insensitive host equality: www.example.com and example.com are the
 *  same site for crawling purposes. */
function sameSite(a: string, b: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return norm(a) === norm(b);
}

function extract(url: string, html: string): PageCheck {
  const pick = (re: RegExp): string => (re.exec(html)?.[1] ?? "").trim();
  const title = pick(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const metaDesc = pick(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i
  ) || pick(/<meta[^>]+content=["']([^"']{1,400})["'][^>]+name=["']description["']/i);
  const h1 = pick(/<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i).replace(/<[^>]+>/g, "").trim();
  const hasOg = /<meta[^>]+property=["']og:(title|image|description)["']/i.test(html);
  const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
  const subheadings = (html.match(/<h[23][\s>]/gi) ?? []).length;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = text ? text.split(" ").length : 0;
  const hookBasis = h1 || title;

  return {
    url,
    title,
    titleLen: title.length,
    hasMetaDesc: metaDesc.length > 0,
    metaDescLen: metaDesc.length,
    h1,
    hasOg,
    hasJsonLd,
    wordCount,
    subheadings,
    hookScore: hookBasis ? scoreHook(hookBasis) : 0,
    text: text.slice(0, 4000),
  };
}

/** One page, fetched and analyzed — powers the per-page rewrite feature. */
export async function fetchPageCheck(raw: string): Promise<PageCheck | null> {
  const u = normalizeUrl(raw);
  if (!u) return null;
  const page = await fetchPage(u);
  return page ? extract(page.finalUrl.href, page.html) : null;
}

/** Same-origin candidate URLs: sitemap first, homepage links as fallback. */
async function discoverPages(
  origin: URL,
  homepageHtml: string,
  cap: number
): Promise<{ urls: string[]; hasSitemap: boolean; lastmod: string | null }> {
  const seen = new Set<string>([origin.href]);
  const urls: string[] = [];
  let hasSitemap = false;
  let lastmod: string | null = null;

  const POOL_MAX = 600; // rank the whole sitemap, then pick — never first-N

  const add = (raw: string) => {
    if (urls.length >= POOL_MAX) return;
    try {
      const u = new URL(raw, origin);
      if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, origin.hostname)) return;
      u.hash = "";
      if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|mp4|mp3|xml|woff2?)$/i.test(u.pathname)) return;
      const key = u.pathname + u.search;
      if (seen.has(key)) return;
      seen.add(key);
      urls.push(u.href);
    } catch {
      /* skip malformed */
    }
  };

  const sitemapXml = await fetchText(new URL("/sitemap.xml", origin), 6000);
  if (sitemapXml && /<(urlset|sitemapindex)/i.test(sitemapXml)) {
    hasSitemap = true;
    // A sitemap index points at child sitemaps — read up to three of them.
    const xmls: string[] = [];
    if (/<sitemapindex/i.test(sitemapXml)) {
      const children = [...sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
        .map((m) => m[1])
        .slice(0, 3);
      for (const child of children) {
        const childUrl = normalizeUrl(child);
        const childXml =
          childUrl && sameSite(childUrl.hostname, origin.hostname)
            ? await fetchText(childUrl, 6000)
            : null;
        if (childXml) xmls.push(childXml);
      }
    } else {
      xmls.push(sitemapXml);
    }
    for (const xml of xmls) {
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        if (urls.length >= POOL_MAX) break;
        add(m[1]);
      }
      for (const m of xml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)) {
        const d = m[1].slice(0, 10);
        if (!lastmod || d > lastmod) lastmod = d;
      }
    }
  }

  if (urls.length < cap) {
    for (const m of homepageHtml.matchAll(/href=["']([^"'#?]{1,300})["']/gi)) {
      if (urls.length >= POOL_MAX) break;
      add(m[1]);
    }
  }

  // Rank the whole pool: content-looking paths first, ordinary pages next,
  // locale-prefixed translations last (they duplicate pages already counted).
  const rank = (u: string): number => {
    let path = "/";
    try {
      path = new URL(u).pathname;
    } catch {
      /* keep default */
    }
    if (/^\/[a-z]{2}(-[a-zA-Z]{2})?(\/|$)/.test(path)) return 2;
    if (/\/(blog|post|article|news|guide|learn|resources)/i.test(path)) return 0;
    return 1;
  };
  urls.sort((a, b) => rank(a) - rank(b));
  return { urls: urls.slice(0, cap - 1), hasSitemap, lastmod };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

const HOOK_MAX = 8; // scoreHook's practical ceiling

export async function analyzeSite(
  rawUrl: string,
  opts: { maxPages?: number } = {}
): Promise<{ ok: true; report: SiteScoreReport; pages: PageCheck[] } | { ok: false; error: string }> {
  const maxPages = Math.max(2, Math.min(150, opts.maxPages ?? 8));
  const entered = normalizeUrl(rawUrl);
  if (!entered) return { ok: false, error: "That doesn't look like a valid URL" };
  if (!/^https?:$/.test(entered.protocol) || isBlockedHost(entered.hostname)) {
    return { ok: false, error: "That address can't be scanned" };
  }

  const home = await fetchPage(entered);
  if (!home) {
    return {
      ok: false,
      error:
        "Couldn't fetch that site — it may be down, blocking automated visitors, or not a public website. We only score what we can actually read.",
    };
  }
  const homepageHtml = home.html;
  // Crawl at the site's real home (post-redirect) — sitemaps and links live
  // on the canonical host, not necessarily the one the user typed.
  const origin = new URL(home.finalUrl.origin + "/");

  const [{ urls, hasSitemap, lastmod }, robotsTxt, llmsTxt] = await Promise.all([
    discoverPages(origin, homepageHtml, maxPages),
    fetchText(new URL("/robots.txt", origin), 5000),
    fetchText(new URL("/llms.txt", origin), 5000),
  ]);

  const hasRss =
    /<link[^>]+type=["']application\/(rss|atom)\+xml["']/i.test(homepageHtml) ||
    Boolean(await fetchText(new URL("/feed", origin), 4000));

  const fetched = await mapLimit(urls, FETCH_CONCURRENCY, async (u) => {
    const html = await fetchText(new URL(u));
    return html ? extract(u, html) : null;
  });
  const pages: PageCheck[] = [extract(origin.href, homepageHtml), ...fetched.filter((p): p is PageCheck => p !== null)];

  // --- Scoring: five sections, 20 points each, every point named ---
  const qualifying = pages.filter((p) => p.wordCount >= 300);
  const avgWords = Math.round(pages.reduce((a, p) => a + p.wordCount, 0) / pages.length);
  const daysSince = lastmod
    ? Math.round((Date.now() - new Date(lastmod).getTime()) / 86_400_000)
    : null;

  const depthNotes: string[] = [];
  let depth = Math.min(12, qualifying.length * 2);
  depthNotes.push(
    `${qualifying.length} of ${pages.length} scanned pages have substantial content (300+ words)`
  );
  if (avgWords >= 600) { depth += 4; depthNotes.push(`Strong average depth: ~${avgWords} words per page`); }
  else if (avgWords >= 300) { depth += 2; depthNotes.push(`Moderate average depth: ~${avgWords} words per page`); }
  else depthNotes.push(`Thin pages: ~${avgWords} words on average — long-form is what repurposes`);
  if (daysSince !== null && daysSince <= 30) { depth += 4; depthNotes.push(`Fresh: updated within the last month`); }
  else if (daysSince !== null && daysSince <= 90) { depth += 2; depthNotes.push(`Last update ~${daysSince} days ago`); }
  else if (daysSince !== null) depthNotes.push(`Stale: last update ~${daysSince} days ago`);

  const avgHook = pages.reduce((a, p) => a + p.hookScore, 0) / pages.length;
  const headlineScore = Math.round(Math.min(1, avgHook / HOOK_MAX) * 20);
  const bestPage = [...pages].sort((a, b) => b.hookScore - a.hookScore)[0];
  const worstPage = [...pages].sort((a, b) => a.hookScore - b.hookScore)[0];
  const headlineNotes = [
    `Average headline strength ${Math.round((avgHook / HOOK_MAX) * 100)}/100 across titles and H1s`,
    bestPage?.h1 || bestPage?.title
      ? `Strongest: “${(bestPage.h1 || bestPage.title).slice(0, 80)}”`
      : "No H1s or titles found to score",
  ];
  if (worstPage && worstPage !== bestPage && (worstPage.h1 || worstPage.title)) {
    headlineNotes.push(`Weakest: “${(worstPage.h1 || worstPage.title).slice(0, 80)}”`);
  }

  const titledOk = pages.filter((p) => p.titleLen >= 15 && p.titleLen <= 65).length / pages.length;
  const metaOk = pages.filter((p) => p.hasMetaDesc && p.metaDescLen >= 50 && p.metaDescLen <= 165).length / pages.length;
  const ogOk = pages.filter((p) => p.hasOg).length / pages.length;
  let discovery = Math.round(titledOk * 4 + metaOk * 4 + ogOk * 4);
  const discoveryNotes = [
    `${Math.round(titledOk * 100)}% of pages have well-sized titles (15–65 chars)`,
    `${Math.round(metaOk * 100)}% have a right-sized meta description`,
    `${Math.round(ogOk * 100)}% have social-share (Open Graph) tags`,
  ];
  if (hasSitemap) { discovery += 4; discoveryNotes.push("sitemap.xml found"); }
  else discoveryNotes.push("No sitemap.xml — search engines are guessing your structure");
  if (hasRss) { discovery += 4; discoveryNotes.push("RSS/Atom feed found"); }
  else discoveryNotes.push("No RSS feed — subscribers and aggregators can't follow you");

  const jsonLdShare = pages.filter((p) => p.hasJsonLd).length / pages.length;
  const avgSubheads = pages.reduce((a, p) => a + p.subheadings, 0) / pages.length;
  let ai = 0;
  const aiNotes: string[] = [];
  if (llmsTxt) { ai += 7; aiNotes.push("llms.txt found — AI assistants get a guided tour"); }
  else aiNotes.push("No llms.txt — AI assistants index you blind (most sites miss this)");
  if (jsonLdShare > 0) { ai += Math.round(3 + jsonLdShare * 4); aiNotes.push(`Structured data (JSON-LD) on ${Math.round(jsonLdShare * 100)}% of pages`); }
  else aiNotes.push("No structured data — answer engines can't cite you cleanly");
  if (avgSubheads >= 3) { ai += 6; aiNotes.push("Well-structured pages (clear subheadings)"); }
  else if (avgSubheads >= 1) { ai += 3; aiNotes.push("Some subheading structure — could be more scannable"); }
  else aiNotes.push("Wall-of-text pages: no subheadings for machines or skimmers");
  if (robotsTxt) aiNotes.push("robots.txt present");

  const trappedPosts = qualifying.length;
  const trappedAssets = trappedPosts * 4; // thread + carousel + newsletter section + short script
  let repurpose = Math.min(20, trappedPosts * 3);
  const repurposeNotes = [
    trappedPosts > 0
      ? `~${trappedAssets} social assets are trapped in the ${trappedPosts} substantial page${trappedPosts === 1 ? "" : "s"} we scanned — threads, carousels, newsletter sections, short scripts`
      : "No long-form content found to repurpose — that's the first thing to fix",
  ];
  if (trappedPosts > 0 && daysSince !== null && daysSince > 90) {
    repurposeNotes.push("That content is sitting idle: nothing new has shipped from it in months");
  }

  const clamp = (n: number) => Math.max(0, Math.min(20, n));
  const sections: ScoreSection[] = [
    { key: "depth", label: "Content depth", score: clamp(depth), notes: depthNotes },
    { key: "headlines", label: "Headline strength", score: clamp(headlineScore), notes: headlineNotes },
    { key: "discovery", label: "Discovery basics", score: clamp(discovery), notes: discoveryNotes },
    { key: "ai", label: "AI findability", score: clamp(ai), notes: aiNotes },
    { key: "repurpose", label: "Repurposing potential", score: clamp(repurpose), notes: repurposeNotes },
  ];
  const total = sections.reduce((a, s) => a + s.score, 0);
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F";

  return {
    ok: true,
    report: {
      url: origin.href,
      fetchedPages: pages.length,
      hasSitemap,
      hasRobots: Boolean(robotsTxt),
      hasLlmsTxt: Boolean(llmsTxt),
      hasRss,
      lastmod,
      sections,
      total,
      grade,
      trappedPosts,
      trappedAssets,
      pages: pages.map(({ text: _text, ...rest }) => rest),
    },
    pages,
  };
}

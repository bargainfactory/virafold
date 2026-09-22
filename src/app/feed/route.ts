import { blogPosts } from "@/lib/data";

const BASE = "https://virafold.ai";

/** RSS 2.0 feed for the blog — subscribers, readers, and aggregators can
 *  follow new posts without an account anywhere. Static per deploy. */
export const dynamic = "force-static";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  const items = blogPosts
    .map((p) => {
      const pub = new Date(p.date);
      const pubDate = isNaN(pub.getTime()) ? new Date().toUTCString() : pub.toUTCString();
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${BASE}/blog/${p.slug}</link>
      <guid isPermaLink="true">${BASE}/blog/${p.slug}</guid>
      <pubDate>${pubDate}</pubDate>
      <category>${esc(p.category)}</category>
      <description>${esc(p.excerpt)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Virafold Blog</title>
    <link>${BASE}/blog</link>
    <atom:link href="${BASE}/feed" rel="self" type="application/rss+xml"/>
    <description>Faceless-creator strategy, repurposing pipelines, and AI-findability guides — from the team building Virafold.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

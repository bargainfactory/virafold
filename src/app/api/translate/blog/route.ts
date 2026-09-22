import { NextRequest, NextResponse } from "next/server";
import { blogPosts } from "@/lib/data";
import { getOrTranslate, isTranslatableLocale } from "@/lib/server/translate";
import { insertEvent } from "@/lib/server/db";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * On-demand article translation. Public but naturally bounded: the cache
 * makes each (post, language) a one-time spend, and the rate limit keeps a
 * single visitor from filling the whole matrix in one sitting.
 */
export async function POST(req: NextRequest) {
  const gate = rateLimit(`xlate:${clientIp(req)}`, 10, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Rate limit reached — try again in a bit" },
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
  const slug = String(b?.slug ?? "").slice(0, 120);
  const locale = String(b?.locale ?? "");
  const post = blogPosts.find((p) => p.slug === slug);
  if (!post) return NextResponse.json({ error: "Unknown article" }, { status: 404 });
  if (!isTranslatableLocale(locale)) {
    return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  }

  const source = { title: post.title, excerpt: post.excerpt, content: post.content };
  const result = await getOrTranslate(`blog:${slug}`, locale, source);
  if (!result) {
    return NextResponse.json(
      { error: "Translation is unavailable right now — try again shortly" },
      { status: 503 }
    );
  }
  if (!result.cached) insertEvent("translate_blog", `/blog/${slug}`, locale);
  return NextResponse.json({ translation: result.payload, cached: result.cached });
}

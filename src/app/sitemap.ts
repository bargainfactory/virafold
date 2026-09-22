import type { MetadataRoute } from "next";
import { blogPosts } from "@/lib/data";
import { locales } from "@/lib/locales";

const BASE = "https://virafold.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  // Build date as lastModified for evergreen pages: the site redeploys with
  // real changes near-weekly, and dateless sitemaps score zero freshness with
  // every crawler that reads them.
  const buildDate = new Date();

  const localizedLandings: MetadataRoute.Sitemap = locales
    .filter((l) => l.code !== "en")
    .map((l) => ({
      url: `${BASE}/${l.code}`,
      lastModified: buildDate,
      changeFrequency: "weekly",
      priority: 0.9,
    }));

  const pages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/audit`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/product`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/how-it-works`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/examples`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/alternatives/opusclip`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/alternatives/repurpose-io`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/tools`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/caption-generator`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/tools/thumbnail-tester`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/video-ideas`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/podcast-chapters`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/website-score`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/site-audit`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/hook-analyzer`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/engagement-calculator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/hashtag-generator`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/channel-compare`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/best-time-to-post`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/tools/media-kit`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/create/youtube-shorts`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/create/tiktok`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/create/linkedin`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/create/newsletter`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/create/thread`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/create/carousel`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/for/podcasters`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/for/coaches`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/for/course-creators`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/for/agencies`, changeFrequency: "monthly", priority: 0.8 },
    ...localizedLandings,
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/contact`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.1 },
  ];

  const articles: MetadataRoute.Sitemap = blogPosts.map((p) => {
    const posted = new Date(p.date);
    return {
      url: `${BASE}/blog/${p.slug}`,
      lastModified: isNaN(posted.getTime()) ? buildDate : posted,
      changeFrequency: "monthly",
      priority: 0.7,
    };
  });

  return [...pages.map((p) => ({ lastModified: buildDate, ...p })), ...articles];
}

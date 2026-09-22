import type { Metadata } from "next";

/** Route-segment metadata for the blog index — the page itself is a client
 *  component, so its title/description live here. */
export const metadata: Metadata = {
  title: "Blog — Faceless Creator Strategy & Repurposing | Virafold",
  description:
    "Guides on faceless YouTube, content repurposing pipelines, channel audits, and AI findability — practical, data-first, and free to read.",
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": "https://virafold.ai/feed" },
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import FreeToolClient from "@/components/free-tools";

/**
 * Free-tool pages: six zero-signup utilities, each targeting its own
 * tool-seeker search intent, each funneling to the product surface it
 * naturally upsells. Deterministic/client-side wherever possible.
 */

interface ToolDef {
  name: string;
  h1: string;
  sub: string;
  faq: { q: string; a: string }[];
}

const TOOLS: Record<string, ToolDef> = {
  "hook-analyzer": {
    name: "Hook Analyzer",
    h1: "Free Hook & Title Analyzer",
    sub: "Paste a hook or video title and get a score out of 100 — with the exact factors that help or hurt it, and three stronger patterns for the same idea. No signup.",
    faq: [
      {
        q: "How is the score calculated?",
        a: "The same deterministic scoring Virafold uses in production: questions, concrete numbers, proven power words, and the 6–26 word sweet spot. No AI black box — you see every factor.",
      },
      {
        q: "Is it really free?",
        a: "Yes — no signup, no card, a fair-use rate limit. It runs pure code, so we can afford to keep it free forever.",
      },
      {
        q: "Can Virafold write hooks for me?",
        a: "Yes — the free generators produce hook-first scripts from any idea, and signed in, Virafold learns from the hooks that actually win on your channel.",
      },
    ],
  },
  "engagement-calculator": {
    name: "Engagement Calculator",
    h1: "Free Engagement Rate Calculator",
    sub: "Followers, average likes, average comments — get your engagement rate and an honest verdict benchmarked to your audience size.",
    faq: [
      {
        q: "What's a good engagement rate?",
        a: "It depends on size: under 10k followers, 5%+ is good; 10k–100k, 3.5%+; over 100k, 2.5%+. Small audiences engage more — benchmarks tighten as you grow.",
      },
      {
        q: "Which platforms does this work for?",
        a: "The formula (likes + comments ÷ followers) applies to TikTok, Instagram, YouTube, X, and LinkedIn alike; the size-band verdicts are cross-platform averages.",
      },
      {
        q: "How do I improve a low rate?",
        a: "Usually hooks and format, not ideas. The free channel audit grades both on your actual videos in 20 seconds.",
      },
    ],
  },
  "hashtag-generator": {
    name: "Hashtag Generator",
    h1: "Free Hashtag Generator",
    sub: "Type your topic, pick a platform, get a ready-to-paste tag set — topic-specific tags plus each platform's proven staples.",
    faq: [
      {
        q: "How many hashtags should I use?",
        a: "3–6 relevant tags typically beat tag walls on TikTok and Instagram; LinkedIn rewards 3 or fewer. Relevance beats volume everywhere.",
      },
      {
        q: "Are these tags researched?",
        a: "Topic tags are generated from your words; platform staples are widely-used evergreen tags. For tags tuned to your niche's winners, the watchlist inside Virafold studies your competitors weekly.",
      },
      {
        q: "Is it free?",
        a: "Completely — it runs in your browser. No signup, no limit.",
      },
    ],
  },
  "channel-compare": {
    name: "Channel Compare",
    h1: "Free YouTube Channel Comparison",
    sub: "Two channels in, two virality grades out — hooks, consistency, timing, format, and engagement, side by side. You vs. anyone.",
    faq: [
      {
        q: "Which channels can I compare?",
        a: "Any two public YouTube channels — yours against a competitor, or two creators you study. Grades come from their recent public videos.",
      },
      {
        q: "Why is there an hourly limit?",
        a: "Each comparison reads two channels' data from YouTube's API. Three comparisons per hour keeps the tool free for everyone.",
      },
      {
        q: "Can I track competitors over time?",
        a: "Yes — inside Virafold, the watchlist re-audits pinned channels weekly, alerts you to their breakouts, and feeds their winning patterns into your own generations.",
      },
    ],
  },
  "best-time-to-post": {
    name: "Best Time to Post",
    h1: "Best Times to Post — Free Checker",
    sub: "Audience-wide best posting windows for TikTok, YouTube, Instagram, LinkedIn, and X — with a downloadable weekly schedule.",
    faq: [
      {
        q: "Are these times exact?",
        a: "They're honest averages across audiences — a strong starting point, not a personal answer. Your audience has its own rhythm, which only your own results reveal.",
      },
      {
        q: "What timezone are the times in?",
        a: "Your audience's local time. If your viewers are mostly in one region, schedule in that region's time.",
      },
      {
        q: "Can this be personalized?",
        a: "Yes — Virafold learns your actual best hours from your measured post results and fills your week at those times with one click.",
      },
    ],
  },
  "media-kit": {
    name: "Media Kit Maker",
    h1: "Free Media Kit Maker",
    sub: "Type your name, niche, audience size, and rate — get a clean, screenshot-ready media kit card sponsors can actually read.",
    faq: [
      {
        q: "What goes in a media kit?",
        a: "Who you are, your niche, audience size, engagement, and your rates. Sponsors decide in seconds — clarity beats decoration.",
      },
      {
        q: "How do I share it?",
        a: "Screenshot the card, or sign up free and Virafold hosts it as a live page at virafold.ai/kit/yourname with real metrics from your connected accounts.",
      },
      {
        q: "How do I price sponsored posts?",
        a: "A common floor is $10–25 per 1,000 followers for a dedicated post, adjusted by engagement and niche. Track what you actually close in Virafold's deal pipeline.",
      },
    ],
  },
};

TOOLS["caption-generator"] = {
  name: "Caption Generator",
  h1: "Free Auto-Subtitle Generator",
  sub: "Upload a short video, get it back with word-timed captions burned in — three styles, three positions, no editing software. Free up to 90 seconds.",
  faq: [
    {
      q: "What are the free limits?",
      a: "Up to 25 MB / ~90 seconds per video, three per hour, with a small watermark. Signed in, captioning is full-length and watermark-free.",
    },
    {
      q: "How accurate are the captions?",
      a: "The video is transcribed automatically and captions are timed to the speech. You pick the style (Bold, Neon, Clean) and position so they never cover the wrong part of the frame.",
    },
    {
      q: "Does it work with any aspect ratio?",
      a: "Yes — your video comes back at its own size and shape, uncut. Only the captions are added.",
    },
  ],
};
TOOLS["thumbnail-tester"] = {
  name: "Thumbnail Tester",
  h1: "Free Thumbnail Tester",
  sub: "See your thumbnail the way viewers actually meet it: in a feed next to competitors, and at the tiny sizes where clicks are really decided. Runs entirely in your browser.",
  faq: [
    {
      q: "Is my image uploaded anywhere?",
      a: "No — the preview renders entirely in your browser. The file never leaves your device.",
    },
    {
      q: "What should I look for?",
      a: "Readability at the smallest size, one clear focal point, and contrast against neighboring thumbnails. If you squint and it turns to mush, so will the click-through.",
    },
    {
      q: "Can Virafold make thumbnails too?",
      a: "Yes — signed in, every rendered clip can generate AI thumbnail art with your title burned on.",
    },
  ],
};
TOOLS["video-ideas"] = {
  name: "Video Ideas",
  h1: "Free Video Ideas Generator",
  sub: "Type your niche, get ten video ideas built on proven title shapes — each scored for hook potential so you know which to make first.",
  faq: [
    {
      q: "Where do the ideas come from?",
      a: "Twelve title patterns that consistently perform across niches, filled with your topic and ranked by the same hook scoring Virafold uses in production.",
    },
    {
      q: "Are these unique to me?",
      a: "The shapes are shared; your niche and execution make them yours. Signed in, Virafold generates ideas from your actual content and learns from your winners.",
    },
    {
      q: "What do I do with a good idea?",
      a: "In Virafold, one click writes the full script and another folds it into 30+ posts — the idea is step one of a pipeline.",
    },
  ],
};
TOOLS["podcast-chapters"] = {
  name: "Podcast Chapters",
  h1: "Free Podcast Chapters & Show Notes Generator",
  sub: "Paste an episode transcript, get timestamped chapters, takeaway show notes, and pull-quotes — ready for YouTube descriptions and podcast platforms.",
  faq: [
    {
      q: "How are timestamps calculated?",
      a: "From each chapter's share of the transcript, scaled to your episode length (or a ~150-words-per-minute estimate if you skip it). Add the real duration for tighter stamps.",
    },
    {
      q: "Where do I get a transcript?",
      a: "Most recorders and hosts export one; otherwise, upload the episode to Virafold and it's transcribed automatically — with word-level timing.",
    },
    {
      q: "Can this whole episode become content?",
      a: "That's Virafold's actual job: the same transcript becomes clips, threads, a newsletter, and carousels — see the podcasters page.",
    },
  ],
};
TOOLS["website-score"] = {
  name: "Website Content Score",
  h1: "Free Website Content Score",
  sub: "Enter your domain and get a grade out of 100 across content depth, headline strength, discovery basics, AI findability, and repurposing potential — every point traced to a named check. No signup.",
  faq: [
    {
      q: "What exactly gets checked?",
      a: "We fetch up to 8 public pages (sitemap first) and run deterministic checks: word counts and freshness, headline scoring on your titles and H1s, meta/OG/sitemap/RSS basics, llms.txt and structured data for AI assistants, and how much long-form content you have to repurpose. The report names every factor.",
    },
    {
      q: "Is this an SEO audit?",
      a: "It overlaps on the basics, but the focus is different: how well your content works for discovery — including by AI assistants — and how much finished social content is sitting unused in your existing pages.",
    },
    {
      q: "What's in the paid Complete Audit?",
      a: "The same analysis across your whole site (up to 120 pages), plus AI page-by-page verdicts, headline rewrites, content-gap mapping, and a prioritized 30-day repurposing plan — $49, fully automated, credited toward your first month if you subscribe.",
    },
    {
      q: "Will you crawl my site aggressively?",
      a: "No — a handful of pages, four at a time, with timeouts, and we identify ourselves as VirafoldBot. If your site blocks bots we say we couldn't read it rather than inventing a score.",
    },
  ],
};

export function generateStaticParams() {
  return Object.keys(TOOLS).map((tool) => ({ tool }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tool: string }>;
}): Promise<Metadata> {
  const { tool } = await params;
  const def = TOOLS[tool];
  if (!def) return {};
  const title = `${def.h1} | Virafold`;
  return {
    title,
    description: def.sub,
    alternates: { canonical: `/tools/${tool}` },
    openGraph: {
      type: "website",
      url: `https://virafold.ai/tools/${tool}`,
      siteName: "Virafold",
      title,
      description: def.sub,
    },
  };
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ tool: string }>;
}) {
  const { tool } = await params;
  const def = TOOLS[tool];
  if (!def) notFound();

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: def.faq.map((x) => ({
      "@type": "Question",
      name: x.q,
      acceptedAnswer: { "@type": "Answer", text: x.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navbar />
      <main className="pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm font-medium text-neon-purple mb-3">Free tool · no signup</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight mb-4">
            {def.h1}
          </h1>
          <p className="text-lg text-cyber-muted leading-relaxed mb-8">{def.sub}</p>

          <FreeToolClient tool={tool} />

          <h2 className="text-xl font-bold text-foreground mt-14 mb-4">Common questions</h2>
          <div className="space-y-4 mb-14">
            {def.faq.map((x) => (
              <div key={x.q} className="bg-cyber-card border border-cyber-border rounded-xl p-5">
                <p className="text-sm font-semibold text-foreground mb-1.5">{x.q}</p>
                <p className="text-sm text-cyber-muted leading-relaxed">{x.a}</p>
              </div>
            ))}
          </div>

          <p className="text-sm text-cyber-muted">
            More free tools:{" "}
            <Link href="/tools" className="text-neon-purple hover:underline">
              see the whole toolbox
            </Link>{" "}
            — or{" "}
            <Link href="/audit" className="text-neon-purple hover:underline">
              run the free channel audit
            </Link>
            .
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}

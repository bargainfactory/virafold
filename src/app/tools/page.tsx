import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  Captions,
  Clock3,
  Gauge,
  Hash,
  IdCard,
  Image,
  Lightbulb,
  ListOrdered,
  Swords,
  Type,
} from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

export const metadata: Metadata = {
  title: "Free Creator Tools | Virafold",
  description:
    "Free, no-signup tools for creators: auto-subtitles, thumbnail tester, video ideas, podcast chapters, hook analyzer, engagement calculator, hashtag generator, channel comparison, posting times, and a media kit maker.",
  alternates: { canonical: "/tools" },
};

const TOOLS = [
  {
    href: "/tools/caption-generator",
    icon: Captions,
    name: "Auto-Subtitle Generator",
    desc: "Your video back with word-timed captions burned in.",
  },
  {
    href: "/tools/thumbnail-tester",
    icon: Image,
    name: "Thumbnail Tester",
    desc: "Your thumbnail in a real feed, at real sizes.",
  },
  {
    href: "/tools/video-ideas",
    icon: Lightbulb,
    name: "Video Ideas Generator",
    desc: "Ten scored ideas for your niche, built on proven shapes.",
  },
  {
    href: "/tools/podcast-chapters",
    icon: ListOrdered,
    name: "Podcast Chapters & Notes",
    desc: "Transcript in — chapters, show notes, and quotes out.",
  },
  {
    href: "/tools/website-score",
    icon: Gauge,
    name: "Website Content Score",
    desc: "Your site graded /100 — depth, headlines, AI findability.",
  },
  {
    href: "/tools/hook-analyzer",
    icon: Type,
    name: "Hook & Title Analyzer",
    desc: "Score any hook out of 100 and see exactly what to fix.",
  },
  {
    href: "/tools/engagement-calculator",
    icon: Calculator,
    name: "Engagement Calculator",
    desc: "Your rate, benchmarked honestly to your audience size.",
  },
  {
    href: "/tools/hashtag-generator",
    icon: Hash,
    name: "Hashtag Generator",
    desc: "Topic-specific tag sets for every major platform.",
  },
  {
    href: "/tools/channel-compare",
    icon: Swords,
    name: "Channel Compare",
    desc: "You vs. any channel — five graded dimensions, side by side.",
  },
  {
    href: "/tools/best-time-to-post",
    icon: Clock3,
    name: "Best Time to Post",
    desc: "Proven posting windows per platform, downloadable.",
  },
  {
    href: "/tools/media-kit",
    icon: IdCard,
    name: "Media Kit Maker",
    desc: "A sponsor-ready kit card from four fields.",
  },
  {
    href: "/audit",
    icon: Gauge,
    name: "Channel Audit",
    desc: "The flagship: your whole channel graded in 20 seconds.",
  },
];

/** The free toolbox: every zero-signup utility in one indexable hub. */
export default function ToolsHub() {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm font-medium text-neon-purple mb-3">Free · no signup required</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight mb-4">
            The free creator toolbox
          </h1>
          <p className="text-lg text-cyber-muted leading-relaxed mb-10 max-w-2xl">
            Eleven working tools, no account, no card. Each one is a small piece of the same
            engine that powers Virafold — free because they cost us almost nothing to run.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            {TOOLS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="group bg-cyber-card border border-cyber-border rounded-2xl p-5 hover:border-neon-purple/50 transition-colors flex items-start gap-4"
              >
                <span className="w-10 h-10 rounded-xl bg-neon-purple/10 border border-neon-purple/30 flex items-center justify-center shrink-0">
                  <t.icon className="w-5 h-5 text-neon-purple" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-cyber-muted mt-1 leading-relaxed">{t.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-cyber-muted group-hover:text-neon-purple transition-colors shrink-0 mt-1" />
              </Link>
            ))}
          </div>

          <p className="text-sm text-cyber-muted mt-10">
            Want the versions that learn your channel?{" "}
            <Link href="/signup" className="text-neon-purple hover:underline">
              Start free
            </Link>{" "}
            — no card required.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}

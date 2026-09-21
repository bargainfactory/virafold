import type { Metadata } from "next";
import Link from "next/link";
import {
  ClipboardCheck,
  FileText,
  Globe2,
  ListChecks,
  Mail,
  Sparkles,
} from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import SiteAuditCta from "@/components/site-audit-cta";

export const metadata: Metadata = {
  title: "Complete Content Audit — Written Fixes for Your Website | Virafold",
  description:
    "A full-site AI audit that hands you the fixes, not homework: ready-to-paste title tags and meta descriptions, a generated llms.txt, page-by-page verdicts, content gaps, and a 30-day repurposing plan. $49, delivered in minutes.",
  alternates: { canonical: "/site-audit" },
};

const FAQ = [
  {
    q: "What do I actually receive?",
    a: "A private report covering up to 120 pages of your site: section scores with every check named, AI verdicts and stronger headlines for your deepest pages, ready-to-paste title tags and meta descriptions, a complete llms.txt file written for your site, 3–5 content gaps, and a prioritized 30-day plan. It's emailed to you and printable as a PDF.",
  },
  {
    q: "Is a human involved?",
    a: "No — it's fully automated AI analysis, which is why it costs $49 and arrives in minutes instead of $2,000 and two weeks. Every deterministic check is named so you can verify it yourself.",
  },
  {
    q: "What if my site can't be crawled?",
    a: "If we can't read your site we say so and make it right — we don't keep money for reports we couldn't produce.",
  },
  {
    q: "How do I apply the fixes?",
    a: "Each fix is written to paste directly into your CMS — title tags, meta descriptions, and an llms.txt file for your site root. If you'd rather turn your existing pages into new content, your $49 is credited toward any Virafold plan within 30 days.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

const DELIVERABLES = [
  {
    icon: Globe2,
    name: "Full-site crawl",
    desc: "Up to 120 pages read and scored individually — not the 8-page sample the free score sees.",
  },
  {
    icon: ClipboardCheck,
    name: "Written fixes, not homework",
    desc: "Ready-to-paste title tags and meta descriptions for your deepest pages, sized and worded to the character.",
  },
  {
    icon: FileText,
    name: "Your llms.txt, written for you",
    desc: "A complete llms.txt file describing your site to AI assistants — the discovery surface most sites still miss.",
  },
  {
    icon: Sparkles,
    name: "Page-by-page verdicts",
    desc: "Blunt AI assessments of your most substantial pages, each with a stronger headline rewrite.",
  },
  {
    icon: ListChecks,
    name: "Gaps + a 30-day plan",
    desc: "The 3–5 topics your site is missing, and seven ordered steps that start with the highest-leverage move.",
  },
  {
    icon: Mail,
    name: "Yours to keep",
    desc: "Emailed on completion, printable as PDF, and $49 credited toward your first month if you subscribe within 30 days.",
  },
];

export default async function SiteAuditLanding({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url } = await searchParams;
  const freeToolHref = url
    ? `/tools/website-score?url=${encodeURIComponent(url)}`
    : "/tools/website-score";
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navbar />
      <main className="min-h-screen bg-background pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon-purple/10 border border-neon-purple/30 text-neon-purple text-xs font-medium mb-4">
              <ClipboardCheck className="w-3.5 h-3.5" /> Complete Content Audit
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold text-foreground mb-4">
              The audit that hands you <span className="gradient-text">the fixes</span>
            </h1>
            <p className="text-cyber-muted max-w-2xl mx-auto text-lg">
              Most audits give you a list of problems. This one gives you the solutions, written
              and ready to paste — plus the plan for everything your site should be publishing
              next.
            </p>
          </div>

          <SiteAuditCta />

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-14 mb-14">
            {DELIVERABLES.map((d) => (
              <div key={d.name} className="bg-cyber-card border border-cyber-border rounded-xl p-5">
                <d.icon className="w-5 h-5 text-neon-purple mb-3" />
                <p className="text-sm font-semibold text-foreground mb-1.5">{d.name}</p>
                <p className="text-sm text-cyber-muted leading-relaxed">{d.desc}</p>
              </div>
            ))}
          </div>

          {/* Show the shape of a written solution — labeled as an example. */}
          <div className="max-w-3xl mx-auto mb-14">
            <h2 className="text-xl font-bold text-foreground text-center mb-2">
              What a written solution looks like
            </h2>
            <p className="text-sm text-cyber-muted text-center mb-6">
              Example format — your report contains fixes written for your actual pages.
            </p>
            <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 font-mono text-xs leading-relaxed overflow-x-auto">
              <p className="text-cyber-muted">/pricing — current title: &quot;Pricing&quot; (7 chars, no keywords)</p>
              <p className="text-success mt-2">→ Ready-to-paste title:</p>
              <p className="text-foreground">&lt;title&gt;Custom Print Pricing — Same-Week Turnaround in NYC&lt;/title&gt;</p>
              <p className="text-success mt-2">→ Ready-to-paste meta description:</p>
              <p className="text-foreground">
                &lt;meta name=&quot;description&quot; content=&quot;Transparent pricing for business cards,
                banners, and custom orders. Upload your file, get a quote in minutes, pick up
                same week in NYC.&quot;&gt;
              </p>
            </div>
          </div>

          <div className="max-w-3xl mx-auto mb-14">
            <h2 className="text-xl font-bold text-foreground text-center mb-6">Questions</h2>
            <div className="space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="bg-cyber-card border border-cyber-border rounded-xl px-5 py-4">
                  <summary className="text-sm font-semibold text-foreground cursor-pointer">
                    {f.q}
                  </summary>
                  <p className="text-sm text-cyber-muted mt-2 leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>

          <p className="text-center text-sm text-cyber-muted">
            Just want the free score first?{" "}
            <Link href={freeToolHref} className="text-neon-purple hover:underline">
              Run it here
            </Link>{" "}
            — no signup.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}

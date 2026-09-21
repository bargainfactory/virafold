"use client";

/**
 * The Complete Content Audit report — the purchased artifact. Owner-only
 * (cookie-authed API), poll-friendly while the crawl runs, print-ready when
 * done. English marketing surface.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Printer, Sparkles } from "lucide-react";

interface WsSection {
  key: string;
  label: string;
  score: number;
  notes: string[];
}
interface FullAudit {
  report: {
    url: string;
    fetchedPages: number;
    hasSitemap: boolean;
    hasLlmsTxt: boolean;
    hasRss: boolean;
    lastmod: string | null;
    sections: WsSection[];
    total: number;
    grade: string;
    trappedPosts: number;
    trappedAssets: number;
    pages: {
      url: string;
      title: string;
      wordCount: number;
      hookScore: number;
    }[];
  };
  coach: {
    summary: string;
    pageAdvice: { url: string; verdict: string; headlineRewrite: string }[];
    contentGaps: string[];
    plan: string[];
    pageFixes?: { url: string; title: string; metaDescription: string }[];
    llmsTxt?: string;
  } | null;
}
interface AuditState {
  id: string;
  url: string;
  status: string;
  report: FullAudit | null;
  error: string | null;
}

function gradeColor(n: number): string {
  if (n >= 70) return "text-success";
  if (n >= 45) return "text-warning";
  return "text-red-400";
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard unavailable — text stays selectable */
        }
      }}
      className="print:hidden shrink-0 text-xs px-2.5 py-1 rounded-md border border-cyber-border text-cyber-muted hover:text-foreground hover:border-neon-purple/50 transition-colors"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export default function SiteAuditReport({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [audit, setAudit] = useState<AuditState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch(`/api/site-audit/${id}`, { cache: "no-store" });
        if (!active) return;
        if (res.status === 401) {
          setFailed("Sign in with the account that purchased this audit to view it.");
          return;
        }
        if (!res.ok) {
          setFailed("This audit doesn't exist or belongs to another account.");
          return;
        }
        const data = (await res.json()) as AuditState;
        setAudit(data);
        if (data.status === "queued" || data.status === "running" || data.status === "pending_payment") {
          timer = setTimeout(load, 5000);
        }
      } catch {
        if (active) timer = setTimeout(load, 8000);
      }
    };
    load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (failed) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <p className="text-cyber-muted">{failed}</p>
          <Link href="/login" className="mt-4 inline-block text-neon-purple hover:underline">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  if (!audit) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neon-purple" />
      </main>
    );
  }

  if (audit.status === "pending_payment") {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <Loader2 className="w-6 h-6 animate-spin text-neon-purple mx-auto mb-4" />
          <h1 className="text-lg font-bold text-foreground mb-2">Waiting for payment confirmation…</h1>
          <p className="text-sm text-cyber-muted">
            If you just completed checkout, this page updates by itself in a few seconds. If you
            cancelled, you can close this page — nothing was charged.
          </p>
        </div>
      </main>
    );
  }

  if (audit.status === "queued" || audit.status === "running") {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <Loader2 className="w-6 h-6 animate-spin text-neon-purple mx-auto mb-4" />
          <h1 className="text-lg font-bold text-foreground mb-2">Crawling {audit.url}…</h1>
          <p className="text-sm text-cyber-muted">
            Reading up to 120 pages, scoring each one, and writing your plan. This usually takes
            2–5 minutes — the page refreshes itself, and the finished report is also emailed to
            you.
          </p>
        </div>
      </main>
    );
  }

  if (audit.status === "failed" || !audit.report) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h1 className="text-lg font-bold text-foreground mb-2">We couldn't complete this audit</h1>
          <p className="text-sm text-cyber-muted">
            {audit.error ?? "The site couldn't be crawled."} Reply to any Virafold email and we'll
            make it right — we don't keep money for reports we couldn't produce.
          </p>
        </div>
      </main>
    );
  }

  const { report, coach } = audit.report;

  return (
    <main className="min-h-screen bg-background print:bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 print:hidden">
          <Link href="/dashboard" className="text-sm text-cyber-muted hover:text-foreground">
            ← Dashboard
          </Link>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-cyber-border text-sm text-cyber-muted hover:text-foreground hover:border-neon-purple/50"
          >
            <Printer className="w-4 h-4" /> Print / save as PDF
          </button>
        </div>

        <header className="mb-10">
          <p className="text-xs font-semibold tracking-widest uppercase text-neon-purple mb-2">
            Complete Content Audit
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground break-all">{report.url}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            <p className={`text-6xl font-bold ${gradeColor(report.total)}`}>{report.grade}</p>
            <div>
              <p className="text-xl font-bold text-foreground">{report.total}/100</p>
              <p className="text-sm text-cyber-muted">
                {report.fetchedPages} pages crawled · sitemap {report.hasSitemap ? "✓" : "✗"} · RSS{" "}
                {report.hasRss ? "✓" : "✗"} · llms.txt {report.hasLlmsTxt ? "✓" : "✗"}
              </p>
              {report.trappedPosts > 0 && (
                <p className="text-sm text-neon-purple mt-1">
                  ≈{report.trappedAssets} social assets trapped in {report.trappedPosts} substantial
                  pages
                </p>
              )}
            </div>
          </div>
        </header>

        {coach && (
          <section className="mb-10 bg-cyber-card border border-neon-purple/30 rounded-xl p-6 print:border-gray-300">
            <h2 className="text-lg font-bold text-foreground mb-2 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-neon-purple" /> The headline finding
            </h2>
            <p className="text-sm text-cyber-muted leading-relaxed">{coach.summary}</p>
          </section>
        )}

        <section className="mb-10">
          <h2 className="text-lg font-bold text-foreground mb-4">Section scores</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {report.sections.map((s) => (
              <div key={s.key} className="bg-cyber-card border border-cyber-border rounded-xl p-5 print:border-gray-300">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">{s.label}</p>
                  <p className={`text-sm font-bold ${gradeColor(s.score * 5)}`}>{s.score}/20</p>
                </div>
                <div className="h-1.5 rounded-full bg-cyber-border mb-3 print:hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-purple to-electric-blue"
                    style={{ width: `${(s.score / 20) * 100}%` }}
                  />
                </div>
                <ul className="space-y-1.5">
                  {s.notes.map((n, i) => (
                    <li key={i} className="text-xs text-cyber-muted leading-relaxed">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {coach && coach.pageAdvice.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-bold text-foreground mb-4">Page-by-page advice</h2>
            <div className="space-y-3">
              {coach.pageAdvice.map((a, i) => (
                <div key={i} className="bg-cyber-card border border-cyber-border rounded-xl p-5 print:border-gray-300">
                  <p className="text-xs text-cyber-muted break-all mb-1.5">{a.url}</p>
                  <p className="text-sm text-foreground leading-relaxed">{a.verdict}</p>
                  {a.headlineRewrite && (
                    <p className="text-sm text-neon-purple mt-2">
                      Stronger headline: “{a.headlineRewrite}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {coach && (coach.pageFixes?.length ?? 0) > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-bold text-foreground mb-1">Ready-to-paste fixes</h2>
            <p className="text-sm text-cyber-muted mb-4">
              Written solutions, not homework — drop these straight into your CMS.
            </p>
            <div className="space-y-3">
              {coach.pageFixes!.map((f, i) => (
                <div key={i} className="bg-cyber-card border border-cyber-border rounded-xl p-5 print:border-gray-300">
                  <p className="text-xs text-cyber-muted break-all mb-3">{f.url}</p>
                  {f.title && (
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] uppercase tracking-wider text-cyber-muted mb-1">Title tag</p>
                        <p className="text-sm text-foreground font-mono break-words">{f.title}</p>
                      </div>
                      <CopyBtn text={f.title} />
                    </div>
                  )}
                  {f.metaDescription && (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] uppercase tracking-wider text-cyber-muted mb-1">Meta description</p>
                        <p className="text-sm text-foreground font-mono break-words">{f.metaDescription}</p>
                      </div>
                      <CopyBtn text={f.metaDescription} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {coach && coach.llmsTxt && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-foreground">Your llms.txt, written for you</h2>
              <CopyBtn text={coach.llmsTxt} />
            </div>
            <p className="text-sm text-cyber-muted mb-4">
              Save this as <span className="font-mono">llms.txt</span> at your site root — it's how
              AI assistants learn what your site offers.
            </p>
            <pre className="bg-cyber-card border border-cyber-border rounded-xl p-5 text-xs text-foreground whitespace-pre-wrap break-words print:border-gray-300">
              {coach.llmsTxt}
            </pre>
          </section>
        )}

        {coach && coach.contentGaps.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-bold text-foreground mb-4">Content gaps</h2>
            <ul className="space-y-2">
              {coach.contentGaps.map((g, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-cyber-muted">
                  <CheckCircle2 className="w-4 h-4 text-electric-blue mt-0.5 shrink-0" /> {g}
                </li>
              ))}
            </ul>
          </section>
        )}

        {coach && coach.plan.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-bold text-foreground mb-4">Your 30-day plan</h2>
            <ol className="space-y-3">
              {coach.plan.map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-cyber-muted">
                  <span className="w-6 h-6 rounded-full bg-neon-purple/15 text-neon-purple text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {!coach && (
          <section className="mb-10 bg-cyber-card border border-warning/40 rounded-xl p-5">
            <p className="text-sm text-cyber-muted">
              The AI coaching layer wasn't available for this run, so this report contains the full
              deterministic analysis only. Reply to your report email and we'll re-run the coaching
              at no charge.
            </p>
          </section>
        )}

        <section className="print:hidden bg-gradient-to-r from-neon-purple/10 to-electric-blue/10 border border-neon-purple/30 rounded-xl p-6 text-center">
          <p className="text-sm text-cyber-muted mb-3">
            Ready to act on it? Paste any page's URL into Virafold and it becomes a thread, a
            carousel, and a newsletter in one run — your $49 is credited toward your first month.
          </p>
          <Link
            href="/dashboard"
            className="inline-block px-6 py-2.5 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90"
          >
            Open your dashboard
          </Link>
        </section>
      </div>
    </main>
  );
}

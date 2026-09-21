/**
 * The Complete Content Audit worker: runs the same analyzer as the free
 * website-score tool, but across the whole sitemap, then layers an LLM coach
 * pass on top — per-page verdicts, content gaps, and a prioritized
 * repurposing roadmap. Jobs queue on payment (Stripe webhook) or on an
 * operator's request, and drain here one at a time off the scheduler tick,
 * mirroring the render worker's pattern.
 */

import {
  getSiteAuditById,
  insertNotification,
  listQueuedSiteAudits,
  updateSiteAudit,
} from "./db";
import { analyzeSite, type PageCheck, type SiteScoreReport } from "./website-score";
import { llmComplete } from "./generate";
import { sendEmail } from "./email";
import { publicOriginStatic } from "./base-url";

const PAID_MAX_PAGES = 120;
const COACH_PAGES = 12; // deepest pages get individual coaching

export interface SiteAuditCoach {
  summary: string;
  pageAdvice: { url: string; verdict: string; headlineRewrite: string }[];
  contentGaps: string[];
  plan: string[];
  /** Ready-to-paste fixes — the "written solutions", not homework. */
  pageFixes: { url: string; title: string; metaDescription: string }[];
  llmsTxt: string;
}

export interface FullSiteAudit {
  report: SiteScoreReport;
  coach: SiteAuditCoach | null; // null = honest "coach unavailable", never invented
  coachEngine: string | null;
}

const COACH_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    pageAdvice: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          verdict: { type: "string" },
          headlineRewrite: { type: "string" },
        },
      },
    },
    contentGaps: { type: "array", items: { type: "string" } },
    plan: { type: "array", items: { type: "string" } },
    pageFixes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          metaDescription: { type: "string" },
        },
      },
    },
    llmsTxt: { type: "string" },
  },
};

async function coachAudit(
  report: SiteScoreReport,
  pages: PageCheck[]
): Promise<{ coach: SiteAuditCoach | null; engine: string | null }> {
  const top = [...pages]
    .sort((a, b) => b.wordCount - a.wordCount)
    .slice(0, COACH_PAGES);
  const digests = top
    .map(
      (p, i) =>
        `PAGE ${i + 1}: ${p.url}\nTitle: ${p.title || "(none)"}\nH1: ${p.h1 || "(none)"}\nWords: ${p.wordCount}\nExcerpt: ${p.text.slice(0, 500)}`
    )
    .join("\n\n");
  const sectionSummary = report.sections
    .map((s) => `${s.label}: ${s.score}/20 — ${s.notes.join("; ")}`)
    .join("\n");

  const system =
    "You are a direct, specific content strategist for creators and small businesses. " +
    "You are given a deterministic site score and excerpts of the site's deepest pages. " +
    "Advise in second person, concretely, with zero hype. Never invent facts about pages you were not shown. " +
    'Respond ONLY with JSON: {"summary": string (3-5 sentences on the site\'s biggest content opportunity), ' +
    '"pageAdvice": [{"url", "verdict" (1-2 blunt sentences), "headlineRewrite" (a stronger title for that page)}] for each page shown, ' +
    '"contentGaps": [3-5 specific topics/formats this site is missing], ' +
    '"plan": [7 ordered action steps for the next 30 days, each one sentence, starting with the highest-leverage repurposing move], ' +
    '"pageFixes": [{"url", "title" (a ready-to-paste <title> tag text, 50-60 chars, front-loaded keywords, no hype), "metaDescription" (ready-to-paste, 120-155 chars, concrete benefit + call to action)}] for each page shown, ' +
    '"llmsTxt": string (a complete, ready-to-paste llms.txt file for this site: a # heading with the site name, a one-paragraph plain-language description of what the site offers and for whom, then a bulleted list of its most important pages with one-line descriptions, using only pages you were shown)}';
  const prompt = `SITE: ${report.url}\nSCORE: ${report.total}/100 (${report.grade})\n\nSECTION RESULTS:\n${sectionSummary}\n\nDEEPEST PAGES:\n${digests}`;

  const result = await llmComplete(system, prompt, COACH_SCHEMA, {
    tier: "flagship",
    maxTokens: 6500,
  });
  if (!result) return { coach: null, engine: null };
  try {
    const raw = result.text;
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    if (!parsed || typeof parsed.summary !== "string") return { coach: null, engine: result.engine };
    return {
      coach: {
        summary: parsed.summary,
        pageAdvice: Array.isArray(parsed.pageAdvice)
          ? parsed.pageAdvice
              .filter((a: Record<string, unknown>) => a && typeof a.url === "string")
              .map((a: Record<string, string>) => ({
                url: String(a.url),
                verdict: String(a.verdict ?? ""),
                headlineRewrite: String(a.headlineRewrite ?? ""),
              }))
          : [],
        contentGaps: Array.isArray(parsed.contentGaps) ? parsed.contentGaps.map(String) : [],
        plan: Array.isArray(parsed.plan) ? parsed.plan.map(String) : [],
        pageFixes: Array.isArray(parsed.pageFixes)
          ? parsed.pageFixes
              .filter((f: Record<string, unknown>) => f && typeof f.url === "string")
              .map((f: Record<string, string>) => ({
                url: String(f.url),
                title: String(f.title ?? ""),
                metaDescription: String(f.metaDescription ?? ""),
              }))
          : [],
        llmsTxt: typeof parsed.llmsTxt === "string" ? parsed.llmsTxt : "",
      },
      engine: result.engine,
    };
  } catch {
    return { coach: null, engine: result.engine };
  }
}

async function processOne(id: string): Promise<void> {
  const audit = getSiteAuditById(id);
  if (!audit || audit.status !== "queued" || !audit.paid) return;
  updateSiteAudit(id, { status: "running" });

  const result = await analyzeSite(audit.url, { maxPages: PAID_MAX_PAGES });
  if (!result.ok) {
    updateSiteAudit(id, { status: "failed", error: result.error, completedAt: new Date().toISOString() });
    insertNotification(audit.userEmail, {
      id: `n-${crypto.randomUUID()}`,
      title: "Site Audit Failed",
      message: `We couldn't crawl ${audit.url}: ${result.error} You have not been charged for a report we couldn't produce — reply to any of our emails and we'll sort it out.`,
      time: "Just now",
      read: false,
      type: "warning",
    });
    return;
  }

  // Coach layer: honest-fail — a missing LLM never fakes advice, the report
  // ships with the deterministic sections and says the coach was unavailable.
  const { coach, engine } = await coachAudit(result.report, result.pages);
  const full: FullSiteAudit = { report: result.report, coach, coachEngine: engine };
  updateSiteAudit(id, {
    status: "ready",
    score: result.report.total,
    report: JSON.stringify(full),
    completedAt: new Date().toISOString(),
  });

  const link = `${publicOriginStatic()}/site-audit/${id}`;
  insertNotification(audit.userEmail, {
    id: `n-${crypto.randomUUID()}`,
    title: "Your Complete Content Audit is ready",
    message: `${audit.url} scored ${result.report.total}/100 (${result.report.grade}) across ${result.report.fetchedPages} pages. Open the full report to see the plan.`,
    time: "Just now",
    read: false,
    type: "success",
  });
  void sendEmail({
    to: audit.userEmail,
    subject: `Your Complete Content Audit: ${result.report.grade} (${result.report.total}/100)`,
    html: `<p>Your audit of <b>${audit.url}</b> is ready.</p><p>We crawled ${result.report.fetchedPages} pages. Overall score: <b>${result.report.total}/100 (${result.report.grade})</b>.</p><p><a href="${link}">Open your full report</a> — section-by-section results, page-level advice, and your 30-day repurposing plan.</p>`,
  });
}

declare global {
  // One audit crawl at a time, surviving dev-mode module reloads.
  var __virafoldSiteAuditBusy: boolean | undefined;
}

/** Drain queued paid audits sequentially; safe to call from any tick. */
export function kickSiteAuditWorker(): void {
  if (globalThis.__virafoldSiteAuditBusy) return;
  const pending = listQueuedSiteAudits();
  if (!pending.length) return;
  globalThis.__virafoldSiteAuditBusy = true;
  (async () => {
    try {
      for (;;) {
        const next = listQueuedSiteAudits()[0];
        if (!next) break;
        try {
          await processOne(next.id);
        } catch (e) {
          updateSiteAudit(next.id, {
            status: "failed",
            error: String(e instanceof Error ? e.message : e).slice(0, 300),
            completedAt: new Date().toISOString(),
          });
        }
      }
    } finally {
      globalThis.__virafoldSiteAuditBusy = false;
    }
  })();
}

/**
 * Site Monitor: recurring re-scores of subscribed sites (paid plans).
 * Runs off the hourly scheduler block — each pass picks the monitors whose
 * last check is over a week old, re-runs the free-tool analyzer (8 pages,
 * cheap and deterministic — no LLM cost), records history, and alerts the
 * owner when the score drops. The pitch: "know when Google or the AI
 * assistants stop finding you, before your traffic graph tells you."
 */

import crypto from "node:crypto";
import {
  insertNotification,
  listDueSiteMonitors,
  recordMonitorCheck,
  touchSiteMonitor,
  type SiteMonitorRow,
} from "./db";
import { analyzeSite, type ScoreSection } from "./website-score";
import { sendEmail, emailConfigured } from "./email";
import { publicOriginStatic } from "./base-url";

const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const PER_PASS = 3; // a few per hourly pass — crawls are polite, not bursty
const ALERT_DROP = 5; // points; below analyzer noise threshold alerts are spam

export const MONITOR_CAPS: Record<string, number> = {
  Free: 0,
  Lite: 1,
  Starter: 1,
  "Creator Pro": 3,
  Agency: 10,
};

function sectionMap(sections: ScoreSection[]): Map<string, ScoreSection> {
  return new Map(sections.map((s) => [s.key, s]));
}

async function checkOne(m: SiteMonitorRow): Promise<void> {
  const result = await analyzeSite(m.url, { maxPages: 8 });
  if (!result.ok) {
    touchSiteMonitor(m.id);
    if (m.lastScore !== null) {
      // Site was reachable before and isn't now — that IS the alert.
      insertNotification(m.userEmail, {
        id: `n-${crypto.randomUUID()}`,
        title: "Site Monitor: site unreachable",
        message: `We couldn't crawl ${m.url} on this week's check: ${result.error} If the site is up for you, check robots.txt and firewall rules — blocked crawlers also mean blocked AI assistants.`,
        time: "Just now",
        read: false,
        type: "warning",
      });
    }
    return;
  }

  const report = result.report;
  const prevScore = m.lastScore;
  const prevSections = m.lastSections
    ? sectionMap(JSON.parse(m.lastSections) as ScoreSection[])
    : null;

  recordMonitorCheck(m.id, report.total, JSON.stringify(report.sections));

  if (prevScore === null) return; // first baseline check — nothing to compare

  const totalDrop = prevScore - report.total;
  const sectionDrops: string[] = [];
  if (prevSections) {
    for (const s of report.sections) {
      const prev = prevSections.get(s.key);
      if (prev && prev.score - s.score >= ALERT_DROP) {
        sectionDrops.push(`${s.label}: ${prev.score} → ${s.score}`);
      }
    }
  }
  if (totalDrop < ALERT_DROP && sectionDrops.length === 0) return;

  const detail = sectionDrops.length
    ? ` Biggest movers — ${sectionDrops.join("; ")}.`
    : "";
  insertNotification(m.userEmail, {
    id: `n-${crypto.randomUUID()}`,
    title: "Site Monitor: score dropped",
    message: `${m.url} fell from ${prevScore} to ${report.total}/100 (${report.grade}) on this week's check.${detail} Open the dashboard for the section breakdown.`,
    time: "Just now",
    read: false,
    type: "warning",
  });
  if (emailConfigured()) {
    const rows = report.sections
      .map((s) => {
        const prev = prevSections?.get(s.key);
        const delta = prev ? s.score - prev.score : 0;
        const mark = delta < 0 ? ` (▼${-delta})` : delta > 0 ? ` (▲${delta})` : "";
        return `<li>${s.label}: <b>${s.score}/20</b>${mark}</li>`;
      })
      .join("");
    void sendEmail({
      to: m.userEmail,
      subject: `Site Monitor alert: ${m.url} dropped to ${report.total}/100`,
      html: `<p style="font-family:sans-serif">Your monitored site <b>${m.url}</b> fell from <b>${prevScore}</b> to <b>${report.total}/100 (${report.grade})</b> on this week's automatic check.</p><ul style="font-family:sans-serif;line-height:1.7">${rows}</ul><p style="font-family:sans-serif">AI Findability drops matter most — that's whether ChatGPT, Claude and Perplexity can still find and cite you.</p><p style="font-family:sans-serif"><a href="${publicOriginStatic()}/dashboard">See the full breakdown →</a></p>`,
    }).catch(() => {});
  }
}

declare global {
  // One monitor sweep at a time, surviving dev-mode module reloads.
  var __virafoldSiteMonitorBusy: boolean | undefined;
}

/** Re-score monitors due for their weekly check; safe to call from any tick. */
export function runSiteMonitors(): void {
  if (globalThis.__virafoldSiteMonitorBusy) return;
  const cutoff = new Date(Date.now() - CHECK_INTERVAL_MS).toISOString();
  const due = listDueSiteMonitors(cutoff, PER_PASS);
  if (!due.length) return;
  globalThis.__virafoldSiteMonitorBusy = true;
  (async () => {
    try {
      for (const m of due) {
        await checkOne(m).catch(() => touchSiteMonitor(m.id));
      }
    } finally {
      globalThis.__virafoldSiteMonitorBusy = false;
    }
  })();
}

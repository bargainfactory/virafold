/**
 * In-process background engine, started once per server via instrumentation.ts:
 *
 * - every tick (1 min): deliver due scheduled posts (text AND rendered clips)
 *   and re-kick the clip render worker
 * - every 6 h: pull real post metrics back from X and YouTube for every
 *   delivered post — the flywheel that feeds exemplar-driven generation
 *   without anyone typing numbers in — and settle A/B hook tests
 * - Mondays: send each active creator their weekly operator brief
 *
 * Scheduled times come from a datetime-local input and are stored without a
 * timezone, so they are interpreted in the server's local time — acceptable
 * for a single-server deployment, and the tick is coarse (once a minute) by
 * design. Real platform delivery still depends on a connected publishing app;
 * without one this performs the same demo-mode publish as the manual button.
 */

import path from "node:path";
import {
  abGroupStats,
  createScheduledPost,
  expireTrials,
  getAsset,
  getClip,
  getPlatformAccount,
  insertAudit,
  insertNotification,
  listAllScheduledPending,
  listPublishedWithExternalId,
  listScheduledPosts,
  listRevenue,
  listUsersDueBrief,
  markAbGroupDecided,
  requeueStuckRenders,
  setLastBriefAt,
  setScheduledExternalId,
  setScheduledStatus,
  topPerformers,
  upsertPostMetrics,
} from "./db";
import { deliverPost, deliverVideo, freshToken } from "./connect";
import { kickRenderWorker } from "./render";
import { kickSiteAuditWorker } from "./site-audit";
import { sendEmail, emailConfigured } from "./email";
import { resolveField } from "./integrations";

const TICK_MS = 60 * 1000;
// Evergreen assets are re-queued this long after each automatic publish.
const RECYCLE_DAYS = 14;
const METRICS_EVERY_TICKS = 360; // 6 hours
const BRIEF_CHECK_EVERY_TICKS = 60; // hourly

function toLocalStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

declare global {
  // Survives Next.js dev-mode module reloads so only one interval ever runs.
  var __virafoldSchedulerStarted: boolean | undefined;
}

export async function publishDuePosts(): Promise<number> {
  const now = Date.now();
  let published = 0;
  for (const post of listAllScheduledPending()) {
    const due = new Date(post.scheduledAt).getTime();
    if (Number.isNaN(due) || due > now) continue;

    let deliveryNote = "";
    let externalId: string | undefined;

    if (post.clipId) {
      // Rendered-clip post: upload the video to YouTube/TikTok when connected.
      const clip = getClip(post.userEmail, post.clipId);
      if (clip?.status === "ready" && clip.outputPath) {
        const result = await deliverVideo(
          post.userEmail,
          post.platform,
          path.join(process.cwd(), clip.outputPath),
          clip.title,
          clip.reason
        );
        if (result) {
          deliveryNote = result.ok
            ? ` ${result.detail}.`
            : ` Delivery failed (${result.detail}) — marked published locally.`;
          externalId = result.externalId;
        }
      } else if (clip && clip.status !== "ready") {
        // Not rendered yet — push the slot 10 minutes and let it retry.
        const retry = new Date(now + 10 * 60 * 1000);
        const { updateScheduledPost } = await import("./db");
        updateScheduledPost(post.userEmail, post.id, { scheduledAt: toLocalStamp(retry) });
        continue;
      }
    } else {
      // Text post: real delivery when the creator has connected this platform;
      // demo-mode publish (status only) otherwise — same contract as the
      // manual button.
      const asset = getAsset(post.userEmail, post.assetId);
      if (asset?.content) {
        const result = await deliverPost(post.userEmail, post.platform, asset.content);
        if (result) {
          deliveryNote = result.ok
            ? ` Delivered to your connected account (${result.detail}).`
            : ` Delivery to your connected account failed (${result.detail}) — marked published locally.`;
          externalId = result.externalId;
        }
      }
    }

    setScheduledStatus(post.userEmail, post.id, "published");
    if (externalId) setScheduledExternalId(post.userEmail, post.id, externalId);
    insertNotification(post.userEmail, {
      id: `n-${crypto.randomUUID()}`,
      title: "Scheduled Post Published",
      message: `"${post.assetName}" went out to ${post.platform} as scheduled.${deliveryNote}`,
      time: "Just now",
      read: false,
      type: "success",
    });
    published++;

    // Evergreen recycling: top content goes back in the queue automatically.
    const asset = post.clipId ? null : getAsset(post.userEmail, post.assetId);
    if (asset?.evergreen) {
      const next = new Date(now + RECYCLE_DAYS * 24 * 60 * 60 * 1000);
      createScheduledPost(post.userEmail, {
        id: `sch-${crypto.randomUUID()}`,
        assetId: post.assetId,
        assetName: post.assetName,
        platform: post.platform,
        scheduledAt: toLocalStamp(next),
        status: "scheduled",
      });
      insertNotification(post.userEmail, {
        id: `n-${crypto.randomUUID()}`,
        title: "Evergreen Re-queued",
        message: `"${post.assetName}" is evergreen — scheduled again for ${post.platform} in ${RECYCLE_DAYS} days.`,
        time: "Just now",
        read: false,
        type: "info",
      });
    }
  }
  return published;
}

/**
 * Pull real performance numbers back from the platforms for every delivered
 * post. X uses each creator's own token (public_metrics); YouTube uses the
 * operator's Data API key (statistics are public). Results land in
 * post_metrics, which topPerformers() and exemplar-fed generation already
 * consume — closing the loop with zero manual entry.
 */
export async function ingestMetrics(): Promise<void> {
  const worklist = listPublishedWithExternalId();

  // X: batch per user (up to 100 ids per call).
  const xByUser = new Map<string, typeof worklist>();
  for (const p of worklist) {
    if (p.platform.toLowerCase() === "x") {
      const arr = xByUser.get(p.userEmail) ?? [];
      arr.push(p);
      xByUser.set(p.userEmail, arr);
    }
  }
  for (const [email, posts] of xByUser) {
    const acct = getPlatformAccount(email, "x");
    if (!acct) continue;
    const token = await freshToken(email, acct);
    if (!token) continue;
    try {
      const ids = posts.slice(0, 100).map((p) => p.externalId).join(",");
      const resp = await fetch(
        `https://api.twitter.com/2/tweets?ids=${ids}&tweet.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      const byId = new Map<string, Record<string, number>>(
        (data?.data ?? []).map((t: { id: string; public_metrics: Record<string, number> }) => [
          t.id,
          t.public_metrics,
        ])
      );
      for (const p of posts) {
        const m = byId.get(p.externalId!);
        if (!m) continue;
        upsertPostMetrics(email, p.id, {
          views: m.impression_count ?? 0,
          likes: m.like_count ?? 0,
          comments: m.reply_count ?? 0,
          source: "auto:x",
        });
      }
    } catch {
      /* next user */
    }
  }

  // YouTube: public statistics via the operator's Data API key.
  const ytKey = resolveField("audit", "youtubeApiKey");
  const ytPosts = worklist.filter((p) => p.platform.toLowerCase() === "youtube");
  if (ytKey && ytPosts.length) {
    try {
      const ids = ytPosts.slice(0, 50).map((p) => p.externalId).join(",");
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${ytKey}`
      );
      if (resp.ok) {
        const data = await resp.json();
        const byId = new Map<string, Record<string, string>>(
          (data?.items ?? []).map((v: { id: string; statistics: Record<string, string> }) => [
            v.id,
            v.statistics,
          ])
        );
        for (const p of ytPosts) {
          const s = byId.get(p.externalId!);
          if (!s) continue;
          upsertPostMetrics(p.userEmail, p.id, {
            views: Number(s.viewCount ?? 0),
            likes: Number(s.likeCount ?? 0),
            comments: Number(s.commentCount ?? 0),
            source: "auto:youtube",
          });
        }
      }
    } catch {
      /* metrics are best-effort */
    }
  }

  settleAbTests();
}

/** Declare A/B hook winners once both variants have measured posts. */
function settleAbTests(): void {
  const rows = abGroupStats();
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.userEmail}|${r.abGroup}`;
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  for (const [, variants] of groups) {
    if (variants.length < 2) continue;
    if (!variants.every((v) => v.measuredPosts > 0)) continue;
    const sorted = [...variants].sort((a, b) => b.views - a.views);
    const [winner, loser] = sorted;
    if (winner.views === loser.views) continue; // no signal yet
    markAbGroupDecided(winner.userEmail, winner.abGroup);
    insertNotification(winner.userEmail, {
      id: `n-${crypto.randomUUID()}`,
      title: "A/B Hook Test Decided",
      message: `"${winner.assetName}" beat "${loser.assetName}" (${winner.views.toLocaleString()} vs ${loser.views.toLocaleString()} views). The winning hook now steers future generations.`,
      time: "Just now",
      read: false,
      type: "success",
    });
  }
}

/** Monday operator brief: what won, what's queued, money, one next action. */
export async function sendWeeklyBriefs(): Promise<void> {
  if (new Date().getDay() !== 1) return; // Mondays, server-local
  for (const u of listUsersDueBrief()) {
    try {
      const top = topPerformers(u.email, 3);
      const posts = listScheduledPosts(u.email);
      const weekAhead = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const queued = posts.filter((p) => {
        if (p.status !== "scheduled") return false;
        const t = new Date(p.scheduledAt).getTime();
        return !Number.isNaN(t) && t < weekAhead;
      }).length;

      const thisMonth = new Date().toISOString().slice(0, 7);
      const prev = new Date();
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      const lastMonth = prev.toISOString().slice(0, 7);
      const revenue = listRevenue(u.email);
      const sum = (m: string) =>
        revenue.filter((r) => r.month === m).reduce((a, r) => a + r.amount, 0);
      const revNow = sum(thisMonth);
      const revPrev = sum(lastMonth);

      const action =
        queued === 0
          ? "Your queue is empty — schedule at least 3 posts today to stay consistent."
          : top.length === 0
            ? "No measured results yet — connect X or YouTube so results flow in automatically."
            : `Double down on what won: make this week's content in the style of "${top[0].assetName}".`;

      const lines = [
        top.length
          ? `Top post: "${top[0].assetName}" — ${top[0].views.toLocaleString()} views on ${top[0].platform}.`
          : "No measured posts yet this period.",
        `Queue: ${queued} post${queued === 1 ? "" : "s"} scheduled for the next 7 days.`,
        `Revenue: $${revNow.toLocaleString()} booked this month (last month $${revPrev.toLocaleString()}).`,
        `Next action: ${action}`,
      ];

      insertNotification(u.email, {
        id: `n-${crypto.randomUUID()}`,
        title: "Your Weekly Brief",
        message: lines.join(" "),
        time: "Just now",
        read: false,
        type: "info",
      });
      if (emailConfigured()) {
        await sendEmail({
          to: u.email,
          subject: "Your Virafold weekly brief",
          html: `<h2 style="font-family:sans-serif">Your week at a glance</h2><ul style="font-family:sans-serif;line-height:1.7">${lines
            .map((l) => `<li>${l}</li>`)
            .join("")}</ul><p style="font-family:sans-serif"><a href="https://virafold.ai/dashboard">Open your dashboard →</a></p>`,
        });
      }
      // Trend Radar rides the same weekly cadence — current niche signal
      // from Grok live search, landing as scored ideas.
      const { runTrendRadar } = await import("./trends");
      await runTrendRadar(u.email).catch(() => {});

      setLastBriefAt(u.email);
    } catch {
      /* one bad brief must not block the rest */
    }
  }
}

let lastSweepDay = "";

export function startScheduler(): void {
  if (globalThis.__virafoldSchedulerStarted) return;
  globalThis.__virafoldSchedulerStarted = true;

  // Renders interrupted by a restart go back in the queue.
  try {
    requeueStuckRenders();
  } catch {
    /* table may not exist yet on very first boot */
  }

  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    publishDuePosts().catch(() => {
      /* a bad tick must never kill the interval */
    });
    try {
      kickRenderWorker();
    } catch {
      /* render worker is best-effort */
    }
    try {
      kickSiteAuditWorker();
    } catch {
      /* audit worker is best-effort */
    }
    if (tick % METRICS_EVERY_TICKS === 0) {
      ingestMetrics().catch(() => {});
    }
    if (tick % BRIEF_CHECK_EVERY_TICKS === 0) {
      sendWeeklyBriefs().catch(() => {});
      // Storage retention: one sweep per day, in the quiet early hours.
      const today = new Date().toISOString().slice(0, 10);
      if (new Date().getHours() >= 4 && lastSweepDay !== today) {
        lastSweepDay = today;
        import("./maintenance")
          .then(({ runRetentionSweep }) => runRetentionSweep())
          .catch(() => {});
      }
      // Site monitors: weekly re-scores, a few per hour (polite crawling).
      import("./site-monitor")
        .then(({ runSiteMonitors }) => runSiteMonitors())
        .catch(() => {});
      // Competitor watchlist: weekly re-audits, a few per hour (YouTube quota).
      (async () => {
        const { listWatchDue } = await import("./db");
        const { checkWatchEntry } = await import("./watch");
        for (const entry of listWatchDue(3)) {
          await checkWatchEntry(entry.userEmail, entry).catch(() => {});
        }
      })().catch(() => {});
      // Operator-granted free trials revert automatically on expiry.
      try {
        for (const trial of expireTrials()) {
          insertNotification(trial.email, {
            id: `n-${crypto.randomUUID()}`,
            title: "Trial Ended",
            message: `Your ${trial.trialPlan} trial has ended — you're back on the ${trial.plan} plan. Upgrade anytime to keep the higher limits.`,
            time: "Just now",
            read: false,
            type: "info",
          });
          insertAudit("system", "user.trial_expired", `${trial.email}: ${trial.trialPlan} → ${trial.plan}`);
        }
      } catch {
        /* trial expiry is best-effort per tick */
      }
    }
  }, TICK_MS);
  // Never hold the process open (build workers, scripts, graceful shutdown).
  timer.unref?.();
}

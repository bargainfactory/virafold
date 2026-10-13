/**
 * Autopilot: the fill-a-week brain, shared by the Schedule tab's manual
 * "Fill my week" button (status "scheduled") and the Monday autopilot run
 * (status "draft" — nothing publishes until the creator approves it in the
 * Review Inbox). One scheduling strategy, two levels of trust.
 */

import {
  bestHoursByPlatform,
  createScheduledPost,
  insertNotification,
  listDraftPosts,
  listUnscheduledAssets,
  type ScheduledPost,
} from "./db";

const DEFAULT_HOURS: Record<string, number> = {
  TikTok: 19,
  YouTube: 15,
  LinkedIn: 9,
  X: 10,
};

export function bestHourMap(email: string): Record<string, { hour: number; source: string }> {
  const out: Record<string, { hour: number; source: string }> = {};
  for (const [platform, hour] of Object.entries(DEFAULT_HOURS)) {
    out[platform] = { hour, source: "default" };
  }
  const best: Record<string, { hour: number; avgViews: number }> = {};
  for (const row of bestHoursByPlatform(email)) {
    // Two measured posts at an hour is the minimum signal worth trusting.
    if (row.samples < 2) continue;
    if (!best[row.platform] || row.avgViews > best[row.platform].avgViews) {
      best[row.platform] = { hour: row.hour, avgViews: row.avgViews };
    }
  }
  for (const [platform, b] of Object.entries(best)) {
    out[platform] = { hour: b.hour, source: "your results" };
  }
  return out;
}

export function platformForType(type: string): string | null {
  const t = type.toLowerCase();
  if (t.includes("short")) return "YouTube";
  if (t.includes("tiktok")) return "TikTok";
  if (t.includes("reel")) return "TikTok"; // Reels deliver via TikTok until a Meta connector exists
  if (t.includes("carousel") || t.includes("linkedin")) return "LinkedIn";
  if (t.includes("thread")) return "X";
  if (t.includes("newsletter") || t.includes("email")) return null; // broadcast, not a platform post
  return "X";
}

function stamp(d: Date, hour: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:00`;
}

/** Place up to 7 ready assets across the next week at best hours. */
export function fillWeek(
  email: string,
  status: "scheduled" | "draft"
): ScheduledPost[] {
  const hours = bestHourMap(email);
  const candidates = listUnscheduledAssets(email, 14)
    .map((a) => ({ asset: a, platform: platformForType(a.type) }))
    .filter((c): c is { asset: (typeof c)["asset"]; platform: string } => c.platform !== null)
    .slice(0, 7);

  return candidates.map((c, i) => {
    const day = new Date();
    day.setDate(day.getDate() + i + 1);
    return createScheduledPost(email, {
      id: `sch-${crypto.randomUUID()}`,
      assetId: c.asset.id,
      assetName: c.asset.name,
      platform: c.platform,
      scheduledAt: stamp(day, hours[c.platform]?.hour ?? 12),
      status,
    });
  });
}

/**
 * Monday autopilot for one opted-in creator: draft the week, tell them once.
 * Idempotent — an existing draft means this week is already waiting on them.
 */
export function runAutopilotFor(email: string): number {
  if (listDraftPosts(email).length > 0) return 0;
  const drafts = fillWeek(email, "draft");
  if (drafts.length > 0) {
    insertNotification(email, {
      id: `n-${crypto.randomUUID()}`,
      title: "Autopilot Drafted Your Week",
      message: `${drafts.length} post${drafts.length === 1 ? "" : "s"} are drafted at your best posting times. Nothing publishes until you approve them in your Inbox.`,
      time: "Just now",
      read: false,
      type: "info",
    });
  }
  return drafts.length;
}

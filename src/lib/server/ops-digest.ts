/**
 * Daily operator digest: the "morning read" that replaces logging into three
 * dashboards. Compiles the last 24h — signups, Stripe events, audit
 * fulfillment, render queue, server errors, monitor checks — into one email +
 * notification for each platform admin. Runs off the scheduler's daily block
 * and on demand from the operator console. Reports facts only; quiet days say
 * so instead of inventing activity.
 */

import { getDb, insertNotification, listErrorLogs, llmUsage } from "./db";
import { sendEmail, emailConfigured } from "./email";

const DAY_MS = 24 * 60 * 60 * 1000;

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function compileOpsDigest(): { lines: string[]; attention: boolean } {
  const conn = getDb();
  const sinceIso = new Date(Date.now() - DAY_MS).toISOString();
  const sinceMs = Date.now() - DAY_MS;
  const lines: string[] = [];
  let attention = false;

  // Growth: who arrived.
  const signups = conn
    .prepare("SELECT email, plan FROM users WHERE created_at >= ? ORDER BY created_at DESC")
    .all(sinceIso) as { email: string; plan: string }[];
  lines.push(
    signups.length
      ? `Signups: ${signups.length} — ${signups.slice(0, 5).map((u) => `${u.email} (${u.plan})`).join(", ")}${signups.length > 5 ? ", …" : ""}`
      : "Signups: none in the last 24h."
  );

  // Money: everything the Stripe webhook and pack routes recorded.
  const money = conn
    .prepare(
      "SELECT action, detail FROM audit_log WHERE ts >= ? AND (actor = 'stripe-webhook' OR action LIKE 'pack.%' OR action LIKE 'site_audit.%' OR action LIKE 'credits.%') ORDER BY id DESC LIMIT 20"
    )
    .all(sinceMs) as { action: string; detail: string }[];
  lines.push(
    money.length
      ? `Revenue events: ${money.length} — ${money.slice(0, 6).map((m) => `${m.action} ${m.detail}`.trim().slice(0, 70)).join(" | ")}`
      : "Revenue events: none."
  );

  // Fulfillment: paid audits must complete; failures are make-good territory.
  const audits = conn
    .prepare("SELECT status, COUNT(*) AS c FROM site_audits WHERE created_at >= ? GROUP BY status")
    .all(sinceIso) as { status: string; c: number }[];
  const failedAudits = conn
    .prepare("SELECT url, error FROM site_audits WHERE status = 'failed' AND created_at >= ? LIMIT 3")
    .all(sinceIso) as { url: string; error: string | null }[];
  if (audits.length) {
    lines.push(`Site audits (24h): ${audits.map((a) => `${a.c} ${a.status}`).join(", ")}.`);
    if (failedAudits.length) {
      attention = true;
      lines.push(
        `⚠ Failed audits need a look (refund/make-good): ${failedAudits.map((f) => `${f.url} — ${(f.error ?? "?").slice(0, 60)}`).join("; ")}`
      );
    }
  } else {
    lines.push("Site audits (24h): none started.");
  }

  // Render queue: depth now, by status.
  const queue = conn
    .prepare("SELECT status, COUNT(*) AS c FROM clips WHERE status IN ('queued','rendering','failed') GROUP BY status")
    .all() as { status: string; c: number }[];
  const failedRenders = queue.find((q) => q.status === "failed")?.c ?? 0;
  lines.push(
    queue.length
      ? `Render queue now: ${queue.map((q) => `${q.c} ${q.status}`).join(", ")}.`
      : "Render queue now: empty."
  );
  if (failedRenders > 0) attention = true;

  // Stability: server errors in the window.
  const errors = listErrorLogs(100).filter((e) => e.ts >= sinceIso);
  if (errors.length) {
    attention = true;
    lines.push(
      `⚠ Server errors (24h): ${errors.length}. Latest: ${errors.slice(0, 3).map((e) => `[${e.context}] ${e.message.slice(0, 70)}`).join(" | ")}`
    );
  } else {
    lines.push("Server errors (24h): none.");
  }

  // Monitors: checks that ran (drop alerts notify their owners separately).
  const checks = conn
    .prepare("SELECT COUNT(*) AS c FROM site_monitor_checks WHERE ts >= ?")
    .get(sinceIso) as { c: number };
  lines.push(`Site-monitor checks run (24h): ${checks.c}.`);

  // Spend signal: cumulative LLM usage by tier (trend beats absolutes).
  const usage = llmUsage();
  if (usage.length) {
    lines.push(
      `LLM usage (cumulative): ${usage.map((u) => `${u.tier} ${u.calls} calls`).join(", ")}.`
    );
  }

  return { lines, attention };
}

/** Compile and deliver the digest to every platform admin. */
export async function runOpsDigest(): Promise<{ lines: string[]; attention: boolean }> {
  const digest = compileOpsDigest();
  const title = digest.attention ? "Operator digest — needs attention" : "Operator digest — all quiet";
  for (const admin of adminEmails()) {
    insertNotification(admin, {
      id: `n-${crypto.randomUUID()}`,
      title,
      message: digest.lines.join(" "),
      time: "Just now",
      read: false,
      type: digest.attention ? "warning" : "info",
    });
    if (emailConfigured()) {
      await sendEmail({
        to: admin,
        subject: `Virafold ${title.toLowerCase()}`,
        html: `<h2 style="font-family:sans-serif">Last 24 hours</h2><ul style="font-family:sans-serif;line-height:1.8">${digest.lines
          .map((l) => `<li>${l}</li>`)
          .join("")}</ul><p style="font-family:sans-serif"><a href="https://virafold.ai/admin">Open the operator console →</a></p>`,
      }).catch(() => {});
    }
  }
  return digest;
}

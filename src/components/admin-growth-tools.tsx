"use client";

/**
 * Operator console: the two growth-ops tools from the operating strategy.
 * 1. Operator digest — the daily morning read (also emailed at ~4am), on
 *    demand here.
 * 2. Prospect outreach kit — paste local-business URLs, get each site's real
 *    score plus a ready-to-send outreach email built from its two weakest
 *    findings. Deterministic: every number in the draft is the real result.
 * English-only like the rest of the console (operator surface).
 */

import { useState } from "react";
import { ClipboardList, Loader2, Megaphone, ShieldAlert } from "lucide-react";

interface SeqEmail {
  day: number;
  purpose: string;
  email: { subject: string; body: string };
}

interface ProspectRow {
  url: string;
  ok: boolean;
  error?: string;
  score?: number;
  grade?: string;
  findings?: string[];
  email?: { subject: string; body: string };
  sequence?: SeqEmail[];
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="text-xs px-2.5 py-1 rounded-md border border-cyber-border text-cyber-muted hover:text-foreground hover:border-neon-purple/50 transition-colors shrink-0"
    >
      {done ? "Copied" : label}
    </button>
  );
}

export default function AdminGrowthTools() {
  // --- Spam cleanup ---
  const [spam, setSpam] = useState<{ count: number; sample: { email: string; name: string }[] } | null>(null);
  const [spamBusy, setSpamBusy] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  async function previewSpam() {
    setSpamBusy(true);
    setPurgeResult(null);
    try {
      const res = await fetch("/api/admin/purge-spam", { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok) setSpam(d);
    } finally {
      setSpamBusy(false);
    }
  }

  async function purgeSpam() {
    if (!spam || spamBusy) return;
    setSpamBusy(true);
    try {
      const res = await fetch("/api/admin/purge-spam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setPurgeResult(
          d.deleted === 0 && d.errors?.length
            ? `Nothing deleted — first error: ${d.errors[0]}`
            : `Deleted ${d.deleted} accounts${d.remaining > 0 ? ` — ${d.remaining} remain, run again` : "."}`
        );
        setSpam(null);
      } else {
        setPurgeResult(String(d?.error ?? "Purge failed"));
      }
    } finally {
      setSpamBusy(false);
    }
  }

  // --- Render regression ---
  const [regr, setRegr] = useState<{ pass: boolean; checks: { name: string; pass: boolean; detail: string }[] } | null>(null);
  const [regrBusy, setRegrBusy] = useState(false);

  async function runRegression() {
    if (regrBusy) return;
    setRegrBusy(true);
    setRegr(null);
    try {
      const res = await fetch("/api/admin/render-regression", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.checks) setRegr(d);
      else setRegr({ pass: false, checks: [{ name: "run", pass: false, detail: String(d?.error ?? `HTTP ${res.status}`) }] });
    } finally {
      setRegrBusy(false);
    }
  }

  // --- Digest ---
  const [digest, setDigest] = useState<{ lines: string[]; attention: boolean } | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);

  async function briefMe() {
    if (digestBusy) return;
    setDigestBusy(true);
    try {
      const res = await fetch("/api/admin/ops-digest", { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.lines) setDigest(d);
    } finally {
      setDigestBusy(false);
    }
  }

  // --- Prospect kit ---
  const [urlsRaw, setUrlsRaw] = useState("");
  const [rows, setRows] = useState<ProspectRow[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");

  async function runKit() {
    if (running) return;
    const urls = urlsRaw
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!urls.length) return;
    setRunning(true);
    setRows([]);
    try {
      for (let i = 0; i < urls.length; i++) {
        setProgress(`Scoring ${i + 1}/${urls.length}: ${urls[i]}`);
        try {
          const res = await fetch("/api/admin/prospect-kit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: urls[i] }),
          });
          const d = (await res.json().catch(() => null)) as ProspectRow | null;
          setRows((prev) => [
            ...prev,
            d && res.ok ? d : { url: urls[i], ok: false, error: d?.error ?? `HTTP ${res.status}` },
          ]);
        } catch {
          setRows((prev) => [...prev, { url: urls[i], ok: false, error: "request failed" }]);
        }
      }
    } finally {
      setRunning(false);
      setProgress("");
    }
  }

  return (
    <>
      {/* Spam cleanup */}
      <div className="bg-cyber-card border border-warning/40 rounded-xl mt-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-warning" />
            <h2 className="font-semibold text-foreground">Signup-spam cleanup</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={previewSpam}
              disabled={spamBusy}
              className="px-4 py-2 rounded-lg border border-cyber-border text-xs text-cyber-muted hover:text-foreground disabled:opacity-50 flex items-center gap-1.5"
            >
              {spamBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Preview matches
            </button>
            {spam && spam.count > 0 && (
              <button
                onClick={purgeSpam}
                disabled={spamBusy}
                className="px-4 py-2 rounded-lg bg-red-500/80 text-white text-xs font-medium hover:bg-red-500 disabled:opacity-50"
              >
                Delete {spam.count} spam accounts
              </button>
            )}
          </div>
        </div>
        <div className="p-6">
          <p className="text-xs text-cyber-muted">
            Bots register victims’ emails with a spam link in the name, riding the verification
            email as a relay. This finds every account with a link in its name and deletes them
            with the full account-purge cascade. Signup now rejects link-names and the emails no
            longer echo user input — this cleans up what got through before.
          </p>
          {spam && (
            <div className="mt-3 text-xs text-foreground/80">
              <p className="font-semibold">{spam.count} matching accounts</p>
              {spam.sample.map((s, i) => (
                <p key={i} className="text-cyber-muted truncate">
                  {s.email} — “{s.name}”
                </p>
              ))}
            </div>
          )}
          {purgeResult && <p className="mt-3 text-xs text-success">{purgeResult}</p>}
        </div>
      </div>

      {/* Render regression */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl mt-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-electric-blue" />
            <h2 className="font-semibold text-foreground">Render regression</h2>
          </div>
          <button
            onClick={runRegression}
            disabled={regrBusy}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {regrBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {regrBusy ? "Rendering…" : "Run regression"}
          </button>
        </div>
        <div className="p-6">
          <p className="text-xs text-cyber-muted">
            Runs the real clip-render recipe against a committed variable-frame-rate fixture —
            plain and tight-cut — and asserts duration, constant 30fps output, and audio. Run it
            after any renderer deploy; takes ~30 seconds of server CPU.
          </p>
          {regr && (
            <div className="mt-3 space-y-1.5">
              <p className={`text-sm font-semibold ${regr.pass ? "text-success" : "text-red-400"}`}>
                {regr.pass ? "PASS — all checks green" : "FAIL"}
              </p>
              {regr.checks.map((c, i) => (
                <p key={i} className={`text-xs ${c.pass ? "text-cyber-muted" : "text-red-400"}`}>
                  {c.pass ? "✓" : "✗"} {c.name} — {c.detail}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Operator digest */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl mt-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-neon-purple" />
            <h2 className="font-semibold text-foreground">Operator digest</h2>
          </div>
          <button
            onClick={briefMe}
            disabled={digestBusy}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {digestBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Brief me now
          </button>
        </div>
        <div className="p-6">
          <p className="text-xs text-cyber-muted mb-3">
            The last 24 hours in one read — signups, revenue events, audit fulfillment, render
            queue, server errors. The same digest is emailed to admins daily around 4am.
          </p>
          {digest ? (
            <ul className="space-y-1.5">
              {digest.lines.map((l, i) => (
                <li
                  key={i}
                  className={`text-sm leading-relaxed ${l.startsWith("⚠") ? "text-warning" : "text-foreground/80"}`}
                >
                  {l}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-cyber-muted">Click “Brief me now” for the current read.</p>
          )}
        </div>
      </div>

      {/* Prospect outreach kit */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl mt-8">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-cyber-border">
          <Megaphone className="w-4 h-4 text-neon-purple" />
          <h2 className="font-semibold text-foreground">Prospect outreach kit</h2>
        </div>
        <div className="p-6">
          <p className="text-xs text-cyber-muted mb-3">
            Paste local-business website URLs (one per line, up to 10 per run). Each gets a real
            score and a 7-email sequence over ~5 weeks — diagnosis, a free fix, the AI-shift
            angle, the itemized offer, a competitor comparison, a direct ask, and a polite
            breakup. Every number in every draft is the site's actual result.
          </p>
          <textarea
            value={urlsRaw}
            onChange={(e) => setUrlsRaw(e.target.value)}
            rows={4}
            placeholder={"brooklyndentalcare.com\nsmithlawnyc.com\n…"}
            className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 font-mono"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={runKit}
              disabled={running || !urlsRaw.trim()}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {running && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {running ? "Scoring…" : "Score & draft emails"}
            </button>
            {progress && <span className="text-xs text-cyber-muted">{progress}</span>}
          </div>

          {rows.length > 0 && (
            <div className="mt-5 space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="bg-cyber-dark border border-cyber-border rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-foreground break-all">{r.url}</p>
                    {r.ok ? (
                      <span className="text-sm font-bold text-neon-purple shrink-0">
                        {r.score}/100 ({r.grade})
                      </span>
                    ) : (
                      <span className="text-xs text-warning shrink-0">{r.error}</span>
                    )}
                  </div>
                  {r.ok && (
                    <>
                      <ul className="mt-2 space-y-1">
                        {r.findings?.map((f, j) => (
                          <li key={j} className="text-xs text-cyber-muted leading-relaxed">
                            • {f}
                          </li>
                        ))}
                      </ul>
                      {/* 7-touch sequence: diagnosis → value → why-now →
                          offer → comparison → ask → breakup. Send manually
                          on the suggested days; stop the moment they reply. */}
                      <div className="mt-3 space-y-1.5">
                        {(r.sequence ?? []).map((s, j) => (
                          <details
                            key={j}
                            className="bg-cyber-card border border-cyber-border rounded-lg px-3 py-2"
                          >
                            <summary className="cursor-pointer text-xs flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-neon-purple shrink-0">
                                Day {s.day}
                              </span>
                              <span className="text-cyber-muted truncate flex-1 min-w-0">
                                {s.purpose}
                              </span>
                            </summary>
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <p className="text-xs text-foreground/80 flex-1 min-w-0 truncate">
                                <span className="text-cyber-muted">Subject:</span>{" "}
                                {s.email.subject}
                              </p>
                              <CopyBtn text={s.email.subject} label="Copy subject" />
                              <CopyBtn text={s.email.body} label="Copy email" />
                            </div>
                            <pre className="mt-2 text-xs text-cyber-muted whitespace-pre-wrap leading-relaxed">
                              {s.email.body}
                            </pre>
                          </details>
                        ))}
                      </div>
                      {(r.sequence?.length ?? 0) > 0 && (
                        <p className="mt-2 text-[11px] text-cyber-muted/80">
                          Send these personally on the suggested days. Stop the sequence the
                          moment they reply — from there it's a conversation, not a cadence.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

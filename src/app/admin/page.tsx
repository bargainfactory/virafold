"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import {
  Activity,
  ArrowLeft,
  Check,
  CheckCircle,
  DollarSign,
  Film,
  Gift,
  Loader2,
  Power,
  ScrollText,
  Shield,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { PricingConfig } from "@/lib/server/pricing";
import AdminGrowthTools from "@/components/admin-growth-tools";

/**
 * Operator console (English-only, admin-gated via ADMIN_EMAILS). Everything
 * here writes shared cross-tenant state, so every endpoint it talks to
 * re-checks admin server-side; this page is presentation only.
 */

interface Totals {
  users: number;
  projects: number;
  assets: number;
  scheduled: number;
  published: number;
}
interface EventCount {
  event: string;
  count: number;
}
interface Flags {
  generationEnabled: boolean;
}
interface AdminUserRow {
  email: string;
  name: string;
  plan: string;
  createdAt: string;
  projects: number;
  assets: number;
  trialEndsAt: string | null;
  trialPrevPlan: string | null;
}

const TRIAL_PLANS = ["Lite", "Starter", "Creator Pro", "Agency"];
interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  detail: string;
  ts: number;
}
interface LlmTierUsage {
  tier: string;
  calls: number;
  inTok: number;
  outTok: number;
}
interface ErrorLogRow {
  id: number;
  context: string;
  message: string;
  stack: string | null;
  ts: string;
}
interface TierEvalRow {
  tier: string;
  engine: string | null;
  ok: boolean;
  assetCount: number;
  avgHookScore: number;
  ms: number;
}

const PLANS = ["Free", "Lite", "Starter", "Creator Pro", "Agency"];

export default function AdminPage() {
  const { addToast } = useApp();
  const [state, setState] = useState<"loading" | "forbidden" | "ready">("loading");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [events, setEvents] = useState<EventCount[]>([]);
  const [flags, setFlagsState] = useState<Flags>({ generationEnabled: true });
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [llm, setLlm] = useState<LlmTierUsage[]>([]);
  const [errors, setErrors] = useState<ErrorLogRow[]>([]);
  const [evalRows, setEvalRows] = useState<TierEvalRow[] | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);

  const runEvals = useCallback(async () => {
    setEvalRunning(true);
    try {
      const res = await fetch("/api/admin/eval", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.results) setEvalRows(d.results);
      else addToast(d?.error ?? "Eval run failed", "error");
    } finally {
      setEvalRunning(false);
    }
  }, [addToast]);
  const [savingPricing, setSavingPricing] = useState(false);
  const [togglingFlag, setTogglingFlag] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!active) return;
      if (res.status === 403) {
        setState("forbidden");
        return;
      }
      if (!res.ok) return;
      const d = await res.json();
      setTotals(d.totals);
      setEvents(d.events);
      setFlagsState(d.flags);
      if (d.llm) setLlm(d.llm);
      if (d.errors) setErrors(d.errors);
      setState("ready");
      const [u, a, p] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/admin/audit", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/admin/pricing", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!active) return;
      if (u) setUsers(u.users);
      if (a) setAudit(a.entries);
      if (p) setPricing(p.pricing);
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggleGeneration = useCallback(async () => {
    setTogglingFlag(true);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationEnabled: !flags.generationEnabled }),
      });
      if (res.ok) {
        const { flags: f } = await res.json();
        setFlagsState(f);
        addToast(f.generationEnabled ? "Generation enabled" : "Generation disabled", "info");
      }
    } finally {
      setTogglingFlag(false);
    }
  }, [flags.generationEnabled, addToast]);

  const changePlan = useCallback(
    async (email: string, plan: string) => {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, plan }),
      });
      if (res.ok) {
        const { users: u } = await res.json();
        setUsers(u);
        addToast(`${email} → ${plan}`);
      } else {
        addToast("Could not update plan", "error");
      }
    },
    [addToast]
  );

  // Timed free trials: per-row draft (plan + days), grant, and early end.
  const [trialDraft, setTrialDraft] = useState<Record<string, { plan: string; days: number }>>({});
  const [trialBusy, setTrialBusy] = useState<string | null>(null);

  const giftTrial = useCallback(
    async (email: string) => {
      const draft = trialDraft[email] ?? { plan: "Creator Pro", days: 14 };
      setTrialBusy(email);
      try {
        const res = await fetch("/api/admin/trial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, plan: draft.plan, days: draft.days }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.users) {
          setUsers(d.users);
          addToast(`${email} → ${draft.plan} trial for ${draft.days} days`);
        } else {
          addToast(d?.error ?? "Could not grant trial", "error");
        }
      } finally {
        setTrialBusy(null);
      }
    },
    [trialDraft, addToast]
  );

  const endTrial = useCallback(
    async (email: string) => {
      setTrialBusy(email);
      try {
        const res = await fetch("/api/admin/trial", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.users) {
          setUsers(d.users);
          addToast(`Trial ended for ${email}`, "info");
        } else {
          addToast(d?.error ?? "Could not end trial", "error");
        }
      } finally {
        setTrialBusy(null);
      }
    },
    [addToast]
  );

  const savePricing = useCallback(async () => {
    if (!pricing) return;
    setSavingPricing(true);
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricing),
      });
      if (res.ok) {
        const { pricing: p } = await res.json();
        setPricing(p);
        addToast("Pricing updated — live immediately");
      } else {
        const d = await res.json().catch(() => null);
        addToast(d?.error ?? "Could not save pricing", "error");
      }
    } finally {
      setSavingPricing(false);
    }
  }, [pricing, addToast]);

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
      </div>
    );
  }

  if (state === "forbidden") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <Shield className="w-10 h-10 text-cyber-muted mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Admins only</h1>
          <p className="text-sm text-cyber-muted mb-6">
            This console is limited to platform administrators. Add your account
            email to the <code className="text-neon-purple">ADMIN_EMAILS</code>{" "}
            environment variable (comma-separated) and sign in again.
          </p>
          <Link
            href="/dashboard"
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const statCards = totals
    ? [
        { label: "Users", value: totals.users, icon: Users, tile: "bg-electric-blue/10 border-electric-blue/30 text-electric-blue" },
        { label: "Projects", value: totals.projects, icon: TrendingUp, tile: "bg-neon-purple/10 border-neon-purple/30 text-neon-purple" },
        { label: "Assets", value: totals.assets, icon: Film, tile: "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-400" },
        { label: "Published", value: totals.published, icon: CheckCircle, tile: "bg-success/10 border-success/30 text-success" },
        { label: "Scheduled", value: totals.scheduled, icon: Activity, tile: "bg-warning/10 border-warning/30 text-warning" },
      ]
    : [];
  const maxEventCount = Math.max(1, ...events.map((e) => e.count));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-cyber-border bg-cyber-dark/50 backdrop-blur-sm px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon-purple to-electric-blue flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Operator Console</h1>
              <p className="text-xs text-cyber-muted">Platform administration — actions are audited</p>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-cyber-muted hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {statCards.map((s) => (
            <div
              key={s.label}
              className="bg-cyber-card border border-cyber-border rounded-xl p-4 hover:border-neon-purple/30 transition-colors"
            >
              <div className={`w-9 h-9 rounded-lg border flex items-center justify-center mb-3 ${s.tile}`}>
                <s.icon className="w-4 h-4" />
              </div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{s.value}</p>
              <p className="text-xs text-cyber-muted mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Kill switch */}
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Power className={`w-5 h-5 ${flags.generationEnabled ? "text-success" : "text-red-400"}`} />
            <div>
              <p className="text-sm font-medium text-foreground">Content generation</p>
              <p className="text-xs text-cyber-muted">
                {flags.generationEnabled
                  ? "Live — uploads, regeneration and the public try-it all run."
                  : "DISABLED — all generation endpoints return 503 until re-enabled."}
              </p>
            </div>
          </div>
          <button
            onClick={toggleGeneration}
            disabled={togglingFlag}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
              flags.generationEnabled
                ? "bg-red-400/10 border border-red-400/40 text-red-400 hover:bg-red-400/20"
                : "bg-success/10 border border-success/40 text-success hover:bg-success/20"
            }`}
          >
            {togglingFlag ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : flags.generationEnabled ? (
              "Disable generation"
            ) : (
              "Enable generation"
            )}
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Funnel events */}
          <div className="bg-cyber-card border border-cyber-border rounded-xl">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-cyber-border">
              <Activity className="w-4 h-4 text-neon-purple" />
              <h2 className="font-semibold text-foreground">Funnel events</h2>
            </div>
            {events.length === 0 ? (
              <p className="px-6 py-8 text-sm text-cyber-muted text-center">No events recorded yet.</p>
            ) : (
              <div className="divide-y divide-cyber-border">
                {events.map((e) => (
                  <div key={e.event} className="relative px-6 py-3">
                    {/* Proportional bar makes the funnel scannable at a glance. */}
                    <div
                      className="absolute inset-y-1.5 left-2 rounded-md bg-gradient-to-r from-neon-purple/15 to-electric-blue/10"
                      style={{ width: `${Math.max(6, (e.count / maxEventCount) * 92)}%` }}
                    />
                    <div className="relative flex items-center justify-between">
                      <span className="text-sm text-foreground">{e.event}</span>
                      <span className="text-sm font-semibold text-neon-purple tabular-nums">{e.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit log */}
          <div className="bg-cyber-card border border-cyber-border rounded-xl">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-cyber-border">
              <ScrollText className="w-4 h-4 text-neon-purple" />
              <h2 className="font-semibold text-foreground">Audit log</h2>
            </div>
            {audit.length === 0 ? (
              <p className="px-6 py-8 text-sm text-cyber-muted text-center">No admin actions recorded yet.</p>
            ) : (
              <div className="divide-y divide-cyber-border max-h-80 overflow-y-auto">
                {audit.map((a) => (
                  <div key={a.id} className="px-6 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-neon-purple/10 border border-neon-purple/30 text-neon-purple">
                        {a.action}
                      </span>
                      <span className="text-xs text-cyber-muted shrink-0">
                        {new Date(a.ts).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-cyber-muted mt-1.5 truncate">
                      {a.actor} — {a.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* LLM efficiency: token telemetry by tier + the model-swap eval gate */}
        <div className="bg-cyber-card border border-cyber-border rounded-xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-neon-purple" />
              <h2 className="font-semibold text-foreground">LLM usage & evals</h2>
            </div>
            <button
              onClick={runEvals}
              disabled={evalRunning}
              title="Runs the golden generation through all three tiers (3 LLM calls)"
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
            >
              {evalRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Run tier evals
            </button>
          </div>
          <div className="p-6 space-y-5">
            <div>
              <p className="text-xs font-medium text-cyber-muted mb-2">
                Tokens spent by tier (route models in Settings → Integrations → Model routing)
              </p>
              {llm.length === 0 ? (
                <p className="text-sm text-cyber-muted">No routed LLM calls recorded yet.</p>
              ) : (
                <div className="grid sm:grid-cols-3 gap-3">
                  {llm.map((u) => (
                    <div key={u.tier} className="bg-cyber-dark border border-cyber-border rounded-xl p-4">
                      <p className="text-xs font-semibold text-neon-purple capitalize mb-1">{u.tier}</p>
                      <p className="text-lg font-bold text-foreground tabular-nums">{u.calls} calls</p>
                      <p className="text-[11px] text-cyber-muted mt-0.5 tabular-nums">
                        {u.inTok.toLocaleString()} in · {u.outTok.toLocaleString()} out
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-cyber-muted mb-2">
                Recent server errors (uncaught route/process failures)
              </p>
              {errors.length === 0 ? (
                <p className="text-sm text-success">No server errors logged — clean.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {errors.map((e) => (
                    <details key={e.id} className="bg-cyber-dark border border-red-400/25 rounded-lg px-3 py-2">
                      <summary className="cursor-pointer text-xs text-foreground flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-red-400 shrink-0">{e.context}</span>
                        <span className="text-cyber-muted truncate">{e.message.slice(0, 120)}</span>
                        <span className="ml-auto text-[10px] text-cyber-muted shrink-0">
                          {new Date(e.ts).toLocaleString()}
                        </span>
                      </summary>
                      {e.stack && (
                        <pre className="mt-2 text-[10px] text-cyber-muted whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {e.stack}
                        </pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </div>
            {evalRows && (
              <div>
                <p className="text-xs font-medium text-cyber-muted mb-2">Latest eval run</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {evalRows.map((r) => (
                    <div
                      key={r.tier}
                      className={`bg-cyber-dark border rounded-xl p-4 ${
                        r.ok ? "border-success/40" : "border-red-400/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-neon-purple capitalize">{r.tier}</p>
                        <span className={`text-[11px] font-medium ${r.ok ? "text-success" : "text-red-400"}`}>
                          {r.ok ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      <p className="text-[11px] text-cyber-muted">{r.engine ?? "no provider available"}</p>
                      <p className="text-[11px] text-cyber-muted mt-1 tabular-nums">
                        {r.assetCount} assets · hook {r.avgHookScore} · {(r.ms / 1000).toFixed(1)}s
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Users */}
        <div className="bg-cyber-card border border-cyber-border rounded-xl">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-cyber-border">
            <Users className="w-4 h-4 text-neon-purple" />
            <h2 className="font-semibold text-foreground">Users</h2>
          </div>
          {users.length === 0 ? (
            <p className="px-6 py-8 text-sm text-cyber-muted text-center">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-cyber-muted border-b border-cyber-border">
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Free trial</th>
                    <th className="px-4 py-3 font-medium text-right">Projects</th>
                    <th className="px-4 py-3 font-medium text-right">Assets</th>
                    <th className="px-6 py-3 font-medium text-right">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyber-border">
                  {users.map((u) => {
                    const onTrial =
                      u.trialEndsAt !== null && new Date(u.trialEndsAt).getTime() > Date.now();
                    const draft = trialDraft[u.email] ?? { plan: "Creator Pro", days: 14 };
                    const initials = u.name
                      .split(/\s+/)
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase();
                    return (
                      <tr key={u.email} className="hover:bg-cyber-dark/40 transition-colors">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-purple to-electric-blue flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {initials || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-foreground font-medium">{u.name}</p>
                              <p className="text-xs text-cyber-muted">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={u.plan}
                            onChange={(e) => changePlan(u.email, e.target.value)}
                            disabled={onTrial}
                            title={onTrial ? "Plan is managed by the active trial" : undefined}
                            className="px-2 py-1.5 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50 disabled:opacity-60"
                          >
                            {(PLANS.includes(u.plan) ? PLANS : [u.plan, ...PLANS]).map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          {onTrial ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] px-2 py-1 rounded-full bg-warning/10 border border-warning/40 text-warning whitespace-nowrap">
                                {u.plan} · ends{" "}
                                {new Date(u.trialEndsAt!).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                              <button
                                onClick={() => endTrial(u.email)}
                                disabled={trialBusy === u.email}
                                className="text-xs text-red-400 hover:underline disabled:opacity-50"
                              >
                                End
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={draft.plan}
                                onChange={(e) =>
                                  setTrialDraft((prev) => ({
                                    ...prev,
                                    [u.email]: { ...draft, plan: e.target.value },
                                  }))
                                }
                                className="px-2 py-1.5 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
                              >
                                {TRIAL_PLANS.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={1}
                                max={90}
                                value={draft.days}
                                onChange={(e) =>
                                  setTrialDraft((prev) => ({
                                    ...prev,
                                    [u.email]: {
                                      ...draft,
                                      days: Math.max(1, Math.min(90, Number(e.target.value) || 1)),
                                    },
                                  }))
                                }
                                className="w-14 px-2 py-1.5 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50 tabular-nums"
                              />
                              <span className="text-[10px] text-cyber-muted">days</span>
                              <button
                                onClick={() => giftTrial(u.email)}
                                disabled={trialBusy === u.email}
                                title="Gift this trial"
                                className="p-1.5 rounded-lg bg-neon-purple/10 border border-neon-purple/40 text-neon-purple hover:bg-neon-purple/20 transition-colors disabled:opacity-50"
                              >
                                {trialBusy === u.email ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Gift className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-cyber-muted tabular-nums">{u.projects}</td>
                        <td className="px-4 py-3 text-right text-cyber-muted tabular-nums">{u.assets}</td>
                        <td className="px-6 py-3 text-right text-xs text-cyber-muted">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pricing */}
        <div className="bg-cyber-card border border-cyber-border rounded-xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-neon-purple" />
              <h2 className="font-semibold text-foreground">Pricing</h2>
            </div>
            <button
              onClick={savePricing}
              disabled={savingPricing || !pricing}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
            >
              {savingPricing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Publish changes
            </button>
          </div>
          {!pricing ? (
            <p className="px-6 py-8 text-sm text-cyber-muted text-center">Loading pricing…</p>
          ) : (
            <div className="p-6 space-y-6">
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {pricing.plans.map((plan, i) => (
                  <div key={plan.priceId} className="bg-cyber-dark border border-cyber-border rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Zap className="w-3.5 h-3.5 text-neon-purple" />
                      <p className="text-xs font-medium text-foreground capitalize">{plan.priceId}</p>
                    </div>
                    {plan.price === "Free" ? (
                      <p className="text-sm text-cyber-muted">Free tier</p>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-cyber-muted">$</span>
                        <input
                          type="number"
                          min={0}
                          value={plan.price}
                          onChange={(e) => {
                            const plans = [...pricing.plans];
                            plans[i] = { ...plan, price: Number(e.target.value) || 0 };
                            setPricing({ ...pricing, plans });
                          }}
                          className="w-full px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                        />
                        <span className="text-xs text-cyber-muted">/mo</span>
                      </div>
                    )}
                    <label className="flex items-center gap-2 mt-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={plan.popular}
                        onChange={(e) => {
                          const plans = pricing.plans.map((p, j) => ({
                            ...p,
                            // Only one plan carries the "popular" ribbon.
                            popular: e.target.checked ? j === i : p.popular && j !== i,
                          }));
                          setPricing({ ...pricing, plans });
                        }}
                        className="accent-[#a855f7]"
                      />
                      <span className="text-xs text-cyber-muted">Popular badge</span>
                    </label>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-cyber-muted mb-3">One-off packages</p>
                <div className="grid sm:grid-cols-3 gap-4">
                  {pricing.oneOffs.map((o, i) => (
                    <div key={o.id} className="bg-cyber-dark border border-cyber-border rounded-xl p-4">
                      <p className="text-xs font-medium text-foreground mb-1">{o.name}</p>
                      <p className="text-[11px] text-cyber-muted mb-2">{o.items}</p>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-cyber-muted">$</span>
                        <input
                          type="number"
                          min={0}
                          value={o.price}
                          onChange={(e) => {
                            const oneOffs = [...pricing.oneOffs];
                            oneOffs[i] = { ...o, price: Number(e.target.value) || 0 };
                            setPricing({ ...pricing, oneOffs });
                          }}
                          className="w-full px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Growth ops: daily digest on demand + SMB prospect outreach kit */}
        <AdminGrowthTools />
      </main>
    </div>
  );
}

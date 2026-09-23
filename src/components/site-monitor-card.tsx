"use client";

/**
 * Site Monitor: weekly automatic re-scores of the user's own site(s) with
 * drop alerts — the recurring companion to the one-off Complete Content
 * Audit. Paid plans only; slots scale with the plan.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";

interface MonitorRow {
  id: string;
  url: string;
  lastScore: number | null;
  lastCheckedAt: string | null;
  history: { score: number; ts: string }[];
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-cyber-muted border-cyber-border";
  if (score >= 70) return "text-success border-success/40 bg-success/10";
  if (score >= 45) return "text-warning border-warning/40 bg-warning/10";
  return "text-red-400 border-red-400/40 bg-red-400/10";
}

export default function SiteMonitorCard() {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [monitors, setMonitors] = useState<MonitorRow[]>([]);
  const [cap, setCap] = useState(0);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/site-monitor", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.monitors) setMonitors(d.monitors);
        if (typeof d?.cap === "number") setCap(d.cap);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/site-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setUrl("");
        addToast(t("monitor.added"));
        load();
      } else {
        addToast(d?.error ?? t("monitor.addFailed"), "error");
      }
    } finally {
      setBusy(false);
    }
  }, [url, busy, addToast, t, load]);

  const remove = useCallback(async (id: string) => {
    setMonitors((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/site-monitor?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => {}
    );
  }, []);

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 mt-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-purple" />
          <h3 className="font-semibold text-foreground">{t("monitor.title")}</h3>
        </div>
        {cap > 0 && (
          <span className="text-[11px] text-cyber-muted">
            {monitors.length}/{cap}
          </span>
        )}
      </div>
      <p className="text-xs text-cyber-muted mb-4">{t("monitor.sub")}</p>

      {cap === 0 ? (
        <p className="text-xs text-warning">{t("monitor.upgrade")}</p>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={t("monitor.ph")}
              className="flex-1 px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
            />
            <button
              onClick={add}
              disabled={busy || !url.trim() || monitors.length >= cap}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              {t("monitor.add")}
            </button>
          </div>

          {monitors.length === 0 ? (
            <p className="text-xs text-cyber-muted">{t("monitor.empty")}</p>
          ) : (
            <div className="space-y-2.5">
              {monitors.map((m) => {
                const prev = m.history[1]?.score ?? null;
                const delta = m.lastScore !== null && prev !== null ? m.lastScore - prev : null;
                return (
                  <div
                    key={m.id}
                    className="flex items-start gap-3 bg-cyber-dark border border-cyber-border rounded-lg p-3"
                  >
                    <span
                      className={`shrink-0 px-2 py-1 rounded-lg border text-xs font-bold ${scoreColor(m.lastScore)}`}
                    >
                      {m.lastScore ?? "—"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground line-clamp-1 break-all">
                        {m.url}
                      </p>
                      <p className="text-[10px] text-cyber-muted/70 mt-0.5 flex items-center gap-1.5">
                        {m.lastCheckedAt ? (
                          <>
                            {t("monitor.checked")}{" "}
                            {new Date(m.lastCheckedAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                            {delta !== null && delta !== 0 && (
                              <span
                                className={`inline-flex items-center gap-0.5 ${delta > 0 ? "text-success" : "text-red-400"}`}
                              >
                                {delta > 0 ? (
                                  <TrendingUp className="w-3 h-3" />
                                ) : (
                                  <TrendingDown className="w-3 h-3" />
                                )}
                                {delta > 0 ? `+${delta}` : delta}
                              </span>
                            )}
                          </>
                        ) : (
                          t("monitor.pending")
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => remove(m.id)}
                      className="text-cyber-muted hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

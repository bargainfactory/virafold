"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Globe, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { track } from "@/lib/track";

interface WsReport {
  url: string;
  fetchedPages: number;
  sections: { key: string; label: string; score: number; notes: string[] }[];
  total: number;
  grade: string;
  trappedPosts: number;
  trappedAssets: number;
}

/**
 * Hero twin of AuditTeaser for site-first creators: same gradient frame,
 * same input+button rhythm, compact inline results, full breakdown on the
 * tool page. Entry copy localized (wst.*); results are the tool's English
 * marketing surface, matching the audit's server-worded report.
 */
export default function WebsiteScoreTeaser() {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<WsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!url.trim() || running) return;
    setRunning(true);
    setError(null);
    track("wst_teaser_run");
    const res = await fetch("/api/tools/website-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    }).catch(() => null);
    setRunning(false);
    const d = await res?.json().catch(() => null);
    if (res?.ok && d?.report) {
      setReport(d.report);
    } else {
      setError(String(d?.error ?? "Something went wrong — try again"));
    }
  };

  const gradeColor =
    (report?.total ?? 0) >= 70
      ? "text-success"
      : (report?.total ?? 0) >= 45
        ? "text-warning"
        : "text-red-400";

  return (
    <section className="w-full pt-6 pb-2">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-6"
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            {t("wst.title")}
          </h2>
          <p className="text-cyber-muted max-w-xl mx-auto">{t("wst.sub")}</p>
        </motion.div>

        {/* Same gradient-glow frame as the channel audit — twin widgets. */}
        <div className="rounded-2xl bg-gradient-to-r from-neon-purple via-fuchsia-500 to-electric-blue p-[1.5px] shadow-[0_0_45px_rgba(168,85,247,0.30)]">
          <div className="bg-cyber-card rounded-2xl p-6 sm:p-8 text-left">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder={t("wst.ph")}
                className="flex-1 px-4 py-3 bg-cyber-dark border border-neon-purple/40 rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple focus:shadow-[0_0_20px_rgba(168,85,247,0.35)] transition-shadow"
              />
              <button
                onClick={run}
                disabled={running || !url.trim()}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 via-neon-purple to-electric-blue text-white font-semibold text-sm shadow-lg shadow-neon-purple/40 hover:shadow-neon-purple/60 hover:brightness-110 transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2 shrink-0"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                {running ? t("wst.running") : t("wst.run")}
              </button>
            </div>
            {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

            {report && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6"
              >
                <div className="flex flex-wrap items-center gap-5">
                  <div className="text-center">
                    <p className={`text-5xl font-bold ${gradeColor}`}>{report.grade}</p>
                    <p className="text-sm text-cyber-muted mt-1">{report.total}/100</p>
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm text-foreground font-medium break-all">{report.url}</p>
                    <p className="text-xs text-cyber-muted mt-1">
                      {report.fetchedPages} page{report.fetchedPages === 1 ? "" : "s"} scanned
                    </p>
                    {report.trappedPosts > 0 && (
                      <p className="mt-1.5 text-sm text-neon-purple">
                        ≈{report.trappedAssets} social assets trapped in {report.trappedPosts}{" "}
                        substantial page{report.trappedPosts === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 space-y-2.5">
                  {report.sections.map((s) => (
                    <div key={s.key} className="flex items-center gap-3">
                      <p className="w-40 shrink-0 text-xs text-cyber-muted">{s.label}</p>
                      <div className="flex-1 h-1.5 rounded-full bg-cyber-border">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-neon-purple to-electric-blue"
                          style={{ width: `${(s.score / 20) * 100}%` }}
                        />
                      </div>
                      <p className="w-10 shrink-0 text-right text-xs font-semibold text-foreground tabular-nums">
                        {s.score}/20
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 text-center">
                  <Link
                    href={`/site-audit?url=${encodeURIComponent(report.url)}`}
                    onClick={() => track("wst_teaser_full")}
                    className="group inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-gradient-to-r from-fuchsia-500 via-neon-purple to-electric-blue text-white text-sm font-bold shadow-lg shadow-neon-purple/50 hover:brightness-110 hover:shadow-neon-purple/70 transition-all"
                  >
                    {t("wst.full")}
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

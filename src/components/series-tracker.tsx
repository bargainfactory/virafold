"use client";

/**
 * Series Tracker: the launch playbook as a live stepper. Seven steps, each
 * detected from real data (cast props, rendered episodes, QA flags, thumbnail
 * tests, scheduled posts, dubs, measured results) — steps light themselves as
 * the work happens, and when all seven are lit the loop rolls to the next
 * episode, because a series is a cadence, not a launch.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { ListChecks, RefreshCw } from "lucide-react";

interface Progress {
  castCount: number;
  episodesReady: number;
  episodesTotal: number;
  flagged: number;
  thumbTests: number;
  scheduledClips: number;
  dubs: number;
  steering: number;
}

export default function SeriesTracker({
  onNavigate,
  onStep,
}: {
  onNavigate?: (tab: string) => void;
  /** Local actions the Studio tab owns: focus script box, open builder, focus lab. */
  onStep: (key: "cast" | "episode" | "thumb") => void;
}) {
  const { t } = useTranslation();
  const [p, setP] = useState<Progress | null>(null);

  const load = useCallback(() => {
    fetch("/api/series-progress", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setP(d))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!p) return null;

  const steps: { key: string; label: string; done: boolean; act: () => void }[] = [
    { key: "cast", label: t("st.s1"), done: p.castCount >= 2, act: () => onStep("cast") },
    { key: "episode", label: t("st.s2"), done: p.episodesReady >= 1, act: () => onStep("episode") },
    {
      key: "review",
      label: t("st.s3"),
      done: p.episodesReady >= 1 && p.flagged === 0,
      act: () => onNavigate?.("Inbox"),
    },
    { key: "thumb", label: t("st.s4"), done: p.thumbTests >= 1, act: () => onStep("thumb") },
    {
      key: "schedule",
      label: t("st.s5"),
      done: p.scheduledClips >= 3,
      act: () => onNavigate?.("Clips"),
    },
    { key: "dub", label: t("st.s6"), done: p.dubs >= 1, act: () => onNavigate?.("Clips") },
    {
      key: "steer",
      label: t("st.s7"),
      done: p.steering >= 1,
      act: () => onNavigate?.("Analytics"),
    },
  ];
  const allDone = steps.every((s) => s.done);
  const currentIdx = allDone ? 1 : steps.findIndex((s) => !s.done);
  const nextEpisode = p.episodesTotal + 1;

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-success" /> {t("st.title")}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-neon-purple/10 border border-neon-purple/30 text-neon-purple font-medium">
            {t("st.next").replace("{n}", String(nextEpisode))}
          </span>
          <button
            onClick={load}
            aria-label={t("st.title")}
            className="p-1.5 text-cyber-muted hover:text-foreground rounded-lg hover:bg-cyber-dark"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-start flex-wrap gap-y-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-start">
            {i > 0 && (
              <span
                className={`w-4 sm:w-6 h-px mt-[5px] mx-0.5 sm:mx-1 ${
                  steps[i - 1].done && s.done ? "bg-success/60" : "bg-cyber-border"
                }`}
              />
            )}
            <button
              onClick={s.act}
              className={`group flex flex-col items-center gap-1 max-w-[76px] text-center ${
                i === currentIdx ? "" : ""
              }`}
            >
              <span
                className={`w-3 h-3 rounded-full border transition-shadow ${
                  s.done
                    ? "bg-success border-success"
                    : i === currentIdx
                      ? "bg-transparent border-neon-purple ring-2 ring-neon-purple/40 animate-pulse"
                      : "bg-transparent border-cyber-muted/60"
                }`}
              />
              <span
                className={`text-[10px] leading-tight ${
                  s.done
                    ? "text-foreground"
                    : i === currentIdx
                      ? "text-neon-purple font-semibold"
                      : "text-cyber-muted"
                } group-hover:text-neon-purple`}
              >
                {s.label}
              </span>
            </button>
          </div>
        ))}
      </div>
      {allDone && <p className="text-[11px] text-success mt-2.5">{t("st.loop").replace("{n}", String(nextEpisode))}</p>}
    </div>
  );
}

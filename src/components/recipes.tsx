"use client";

/**
 * Recipes: outcome-first shortcuts on the Overview tab. Each card is one
 * input and one button mapped onto an existing pipeline, so new creators see
 * "what can I make?" instead of twelve tabs. Outputs land where they always
 * do (review → Inbox, renders → Clips, posts → Schedule).
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Calendar, Film, Link2, Loader2, Moon } from "lucide-react";

export default function Recipes({
  onNavigate,
  addToast,
}: {
  onNavigate: (tab: string) => void;
  addToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const { t } = useTranslation();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) setVals((v) => ({ ...v, [key]: "" }));
      else if (r.error) addToast(r.error, "error");
    } finally {
      setBusy(null);
    }
  };

  const post = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => null);
    return { ok: res.ok, error: res.ok ? undefined : (d?.error as string) ?? t("clips.renderFailed"), data: d };
  };

  const locale = () => (typeof window === "undefined" ? "en" : localStorage.getItem("ef_locale") || "en");

  const cards: {
    key: string;
    icon: React.ReactNode;
    title: string;
    desc: string;
    placeholder?: string;
    cta: string;
    go: () => void;
  }[] = [
    {
      key: "article",
      icon: <Link2 className="w-4 h-4 text-electric-blue" />,
      title: t("rec.article"),
      desc: t("rec.articleDesc"),
      placeholder: "https://…",
      cta: t("rec.articleCta"),
      go: () =>
        run("article", async () => {
          const u = (vals.article ?? "").trim();
          if (!/^https?:\/\//.test(u)) return { ok: false, error: t("rec.needUrl") };
          const r = await post("/api/projects", { title: "", sourceUrl: u, locale: locale() });
          if (r.ok) {
            addToast(t("rec.articleQueued"));
            onNavigate("Inbox");
          }
          return r;
        }),
    },
    {
      key: "cartoon",
      icon: <Film className="w-4 h-4 text-fuchsia-400" />,
      title: t("rec.cartoon"),
      desc: t("rec.cartoonDesc"),
      placeholder: t("rec.ideaPh"),
      cta: t("rec.cartoonCta"),
      go: () =>
        run("cartoon", async () => {
          const idea = (vals.cartoon ?? "").trim();
          if (idea.length < 10) return { ok: false, error: t("rec.needIdea") };
          const r = await post("/api/studio-video", {
            input: idea,
            style: "cartoon",
            animate: true,
            locale: locale(),
          });
          if (r.ok) {
            addToast(t("studio.queued"));
            onNavigate("Clips");
          }
          return r;
        }),
    },
    {
      key: "ambient",
      icon: <Moon className="w-4 h-4 text-electric-blue" />,
      title: t("rec.ambient"),
      desc: t("rec.ambientDesc"),
      placeholder: t("rec.scenePh"),
      cta: t("rec.ambientCta"),
      go: () =>
        run("ambient", async () => {
          const scene = (vals.ambient ?? "").trim();
          if (scene.length < 10) return { ok: false, error: t("rec.needIdea") };
          const r = await post("/api/studio-video", { input: scene, style: "ambient" });
          if (r.ok) {
            addToast(t("studio.queued"));
            onNavigate("Clips");
          }
          return r;
        }),
    },
    {
      key: "week",
      icon: <Calendar className="w-4 h-4 text-success" />,
      title: t("rec.week"),
      desc: t("rec.weekDesc"),
      cta: t("rec.weekCta"),
      go: () =>
        run("week", async () => {
          const r = await post("/api/schedule/smart", {});
          if (r.ok) {
            addToast(t("rec.weekDone"));
            onNavigate("Schedule");
          }
          return r;
        }),
    },
  ];

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-3">{t("rec.title")}</h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.key} className="bg-cyber-card border border-cyber-border rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {c.icon}
              <p className="text-sm font-medium text-foreground">{c.title}</p>
            </div>
            <p className="text-xs text-cyber-muted flex-1">{c.desc}</p>
            {c.placeholder !== undefined && (
              <input
                type="text"
                value={vals[c.key] ?? ""}
                onChange={(e) => setVals((v) => ({ ...v, [c.key]: e.target.value }))}
                placeholder={c.placeholder}
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
              />
            )}
            <button
              onClick={c.go}
              disabled={busy !== null}
              className="px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {busy === c.key && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {c.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

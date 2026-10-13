"use client";

/**
 * Animation Studio as its own dashboard tab (Create group): one input — an
 * idea or a full script — plus a visual style, out comes a finished video.
 * Style presets carry art direction AND motion language; cartoon adds a
 * recurring-character sheet for scene-to-scene consistency. Renders queue
 * through the Clips tab, where the creator is sent after submitting.
 */

import { useCallback, useState } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { Check, Film, Loader2, Sparkles } from "lucide-react";

export default function StudioTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [style, setStyle] = useState("cartoon");
  const [animate, setAnimate] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = useCallback(async () => {
    if (busy || input.trim().length < 10) return;
    setBusy(true);
    try {
      const res = await fetch("/api/studio-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: input.trim(),
          style,
          animate: style === "ambient" ? false : animate,
          locale: localStorage.getItem("ef_locale") || "en",
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setInput("");
        addToast(t("studio.queued"));
        onNavigate?.("Clips");
      } else {
        addToast(d?.error ?? t("clips.renderFailed"), "error");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, input, style, animate, addToast, t, onNavigate]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
          <Sparkles className="w-6 h-6 text-fuchsia-400" /> {t("studio.title")}
        </h1>
        <p className="text-sm text-cyber-muted mt-1">{t("studio.sub")}</p>
      </div>

      <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 space-y-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          placeholder={t("studio.placeholder")}
          className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 resize-y"
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {(["cartoon", "explainer", "cinematic", "documentary", "ambient"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                style === s
                  ? "border-fuchsia-500/60 bg-fuchsia-500/10"
                  : "border-cyber-border bg-cyber-dark hover:border-cyber-muted"
              }`}
            >
              <span className={`block text-xs font-medium ${style === s ? "text-fuchsia-300" : "text-foreground"}`}>
                {t(`studio.s.${s}`)}
              </span>
              <span className="block text-[11px] text-cyber-muted mt-0.5">{t(`studio.d.${s}`)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {style !== "ambient" ? (
            <button
              onClick={() => setAnimate((v) => !v)}
              aria-pressed={animate}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                animate
                  ? "bg-fuchsia-500/20 border-fuchsia-500/60 text-fuchsia-300 shadow-[0_0_12px_rgba(217,70,239,0.25)]"
                  : "bg-cyber-dark border-cyber-border text-cyber-muted hover:text-foreground hover:border-fuchsia-500/40"
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              {t("studio.motion")}
              {animate && <Check className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="text-xs text-cyber-muted">{t("studio.ambientNote")}</span>
          )}
          <button
            onClick={create}
            disabled={busy || input.trim().length < 10}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
            {t("studio.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

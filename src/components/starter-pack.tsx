"use client";

/**
 * First-run starter pack: shown only while the account has zero projects.
 * One niche input → three scored ideas land in the backlog with the top one
 * already scripted, so the first session produces material, not homework.
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useApp } from "@/lib/context";
import { Loader2, Rocket } from "lucide-react";

export default function StarterPack({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { t } = useTranslation();
  const { addToast } = useApp();
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const go = async () => {
    if (busy || niche.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await fetch("/api/starter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim(),
          locale: localStorage.getItem("ef_locale") || "en",
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setDone(true);
        addToast(t("starter.done"));
        onNavigate("Ideas");
      } else {
        addToast(d?.error ?? t("ideas.scriptFailed"), "error");
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) return null;

  return (
    <div className="bg-gradient-to-r from-neon-purple/10 to-electric-blue/10 border border-neon-purple/30 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Rocket className="w-4 h-4 text-neon-purple" />
        <h2 className="text-sm font-semibold text-foreground">{t("starter.title")}</h2>
      </div>
      <p className="text-xs text-cyber-muted mb-3">{t("starter.sub")}</p>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder={t("starter.placeholder")}
          className="flex-1 min-w-[200px] px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
        />
        <button
          onClick={go}
          disabled={busy || niche.trim().length < 2}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
          {t("starter.cta")}
        </button>
      </div>
    </div>
  );
}

"use client";

/**
 * White-label reports (Audit tab): agencies put their own name on purchased
 * audit reports — "Prepared by X" replaces the Virafold sales framing, so a
 * $349 credit pack becomes resellable client deliverables.
 */

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";

export default function ReportBrandCard() {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [brand, setBrand] = useState("");
  const [eligible, setEligible] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/report-brand", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setBrand(String(d.brand ?? ""));
          setEligible(Boolean(d.eligible));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/report-brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setBrand(String(d?.brand ?? ""));
        addToast(d?.brand ? t("wl.saved") : t("wl.cleared"), "success");
      } else {
        addToast(d?.error ?? t("wl.saveFailed"), "error");
      }
    } finally {
      setBusy(false);
    }
  }, [brand, busy, addToast, t]);

  if (!loaded) return null;

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <BadgeCheck className="w-4 h-4 text-neon-purple" />
        <h3 className="font-semibold text-foreground">{t("wl.title")}</h3>
      </div>
      <p className="text-xs text-cyber-muted mb-4">{t("wl.sub")}</p>

      {!eligible ? (
        <p className="text-xs text-warning">{t("wl.upgrade")}</p>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            maxLength={60}
            placeholder={t("wl.ph")}
            className="flex-1 px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
          />
          <button
            onClick={save}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("wl.save")}
          </button>
        </div>
      )}
    </div>
  );
}

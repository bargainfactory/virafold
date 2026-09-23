"use client";

/**
 * WordPress connection (Settings): stores an Application Password (encrypted
 * at rest) after live verification, powering one-click apply of audit fixes.
 * Honest scope is stated in the copy: core REST updates page/post titles and
 * excerpts; plugin-owned SEO meta fields are not touched.
 */

import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, Unplug } from "lucide-react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";

export default function WordPressCard() {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [status, setStatus] = useState<{ connected: boolean; siteUrl?: string; username?: string } | null>(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/wordpress", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => setStatus({ connected: false }));
  }, []);

  const connect = useCallback(async () => {
    if (busy || !siteUrl.trim() || !username.trim() || !appPassword.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wordpress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: siteUrl.trim(), username: username.trim(), appPassword: appPassword.trim() }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.connected) {
        setStatus(d);
        setAppPassword("");
        addToast(t("wp.connectedAs", { name: String(d.name ?? d.username) }), "success");
      } else {
        addToast(d?.error ?? t("wp.connectFailed"), "error");
      }
    } catch {
      addToast(t("wp.connectFailed"), "error");
    } finally {
      setBusy(false);
    }
  }, [busy, siteUrl, username, appPassword, addToast, t]);

  const disconnect = useCallback(async () => {
    setStatus({ connected: false });
    await fetch("/api/wordpress", { method: "DELETE" }).catch(() => {});
  }, []);

  const inputCls =
    "w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50";

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Globe className="w-4 h-4 text-neon-purple" />
        <h3 className="font-semibold text-foreground">{t("wp.title")}</h3>
      </div>
      <p className="text-xs text-cyber-muted mb-4">{t("wp.sub")}</p>

      {status?.connected ? (
        <div className="flex items-center justify-between gap-3 bg-cyber-dark border border-success/30 rounded-lg p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground break-all">{status.siteUrl}</p>
            <p className="text-[11px] text-cyber-muted mt-0.5">
              {t("wp.connected")} · {status.username}
            </p>
          </div>
          <button
            onClick={disconnect}
            className="shrink-0 flex items-center gap-1.5 text-xs text-cyber-muted hover:text-red-400 transition-colors"
          >
            <Unplug className="w-3.5 h-3.5" /> {t("wp.disconnect")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder={t("wp.sitePh")}
            className={inputCls}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("wp.userPh")}
              className={inputCls}
            />
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder={t("wp.appPassPh")}
              className={inputCls}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-cyber-muted">{t("wp.help")}</p>
            <button
              onClick={connect}
              disabled={busy || !siteUrl.trim() || !username.trim() || !appPassword.trim()}
              className="shrink-0 px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("wp.connect")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * The Complete Content Audit purchase form: URL in (prefilled from ?url=
 * when arriving from a free score), then the same state machine as the tool
 * card — checkout, operator fast-path, honest demo message, or signup.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { track } from "@/lib/track";

function CtaInner() {
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    track("site_audit_buy_click");
    try {
      const res = await fetch("/api/site-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (res.status === 401) {
        window.location.href = `/signup?next=${encodeURIComponent(`/site-audit?url=${url.trim()}`)}`;
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      if (data?.operator && data?.id) {
        window.location.href = `/site-audit/${data.id}`;
        return;
      }
      if (data?.demo) {
        setMsg(
          "Payments aren't live quite yet. Create a free account and you'll be first to know when the Complete Audit opens."
        );
        return;
      }
      setMsg(String(data?.error ?? "Could not start the audit — try again shortly"));
    } catch {
      setMsg("Could not start the audit — try again shortly");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-2xl bg-gradient-to-r from-neon-purple via-fuchsia-500 to-electric-blue p-[1.5px] shadow-[0_0_45px_rgba(168,85,247,0.30)]">
        <div className="bg-cyber-card rounded-2xl p-6 text-left">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="yourdomain.com"
              className="flex-1 px-4 py-3 bg-cyber-dark border border-neon-purple/40 rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple"
            />
            <button
              onClick={start}
              disabled={busy || !url.trim()}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 via-neon-purple to-electric-blue text-white font-semibold text-sm shadow-lg shadow-neon-purple/40 hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Get my audit — $49
            </button>
          </div>
          <p className="mt-3 text-xs text-cyber-muted">
            Fully automated AI audit — delivered in minutes, emailed to you, and the $49 is
            credited toward your first month if you subscribe within 30 days.
          </p>
          {msg && <p className="mt-3 text-sm text-warning">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

export default function SiteAuditCta() {
  return (
    <Suspense fallback={null}>
      <CtaInner />
    </Suspense>
  );
}

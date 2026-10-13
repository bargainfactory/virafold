"use client";

/**
 * Review Inbox: every item waiting on the creator's judgment, one list, one
 * action each. Projects in review and honesty-flagged assets come from the
 * bootstrap the app already holds; server-only items (ready-but-unscheduled
 * clips, failed renders, broken publishes, autopilot drafts) come from
 * /api/inbox. The product's promise — "it runs, you approve" — as a surface.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { Asset, Project } from "@/lib/data";
import {
  Calendar,
  Check,
  CheckCircle,
  Film,
  Inbox,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";

interface ServerInbox {
  clipsReady: { id: string; title: string; kind: string }[];
  clipsFailed: { id: string; title: string; error: string | null }[];
  postsFailed: { id: string; assetName: string; platform: string }[];
  postsDraft: { id: string; assetName: string; platform: string; scheduledAt: string }[];
  autopilot: boolean;
}

export default function InboxTab({
  projects,
  assets,
  onApprove,
  onViewAsset,
  go,
  addToast,
}: {
  projects: Project[];
  assets: Asset[];
  onApprove: (projectId: string) => void;
  onViewAsset: (asset: Asset) => void;
  go: (tab: string) => void;
  addToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const { t } = useTranslation();
  const [server, setServer] = useState<ServerInbox | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [apBusy, setApBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/inbox", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setServer(d))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const postAction = useCallback(
    async (action: "approvePost" | "dismissPost", id: string) => {
      setBusyId(id);
      try {
        const res = await fetch("/api/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, id }),
        });
        if (res.ok) {
          addToast(t(action === "approvePost" ? "inbox.postApproved" : "inbox.postDismissed"));
          load();
        }
      } finally {
        setBusyId(null);
      }
    },
    [addToast, t, load]
  );

  const toggleAutopilot = useCallback(async () => {
    if (!server || apBusy) return;
    setApBusy(true);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !server.autopilot }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        addToast(
          d?.autopilot
            ? d?.drafted > 0
              ? t("inbox.apOnDrafted").replace("{n}", String(d.drafted))
              : t("inbox.apOn")
            : t("inbox.apOff")
        );
        load();
      }
    } finally {
      setApBusy(false);
    }
  }, [server, apBusy, addToast, t, load]);

  const reviewProjects = projects.filter((p) => p.status === "review");
  const flaggedAssets = assets.filter((a) => a.flags && a.flags.length > 0 && a.status === "draft");
  const total =
    reviewProjects.length +
    flaggedAssets.length +
    (server
      ? server.clipsReady.length +
        server.clipsFailed.length +
        server.postsFailed.length +
        server.postsDraft.length
      : 0);

  const Row = ({
    icon,
    tone,
    title,
    detail,
    children,
  }: {
    icon: React.ReactNode;
    tone: string;
    title: string;
    detail: string;
    children: React.ReactNode;
  }) => (
    <div className="flex items-center gap-3 bg-cyber-card border border-cyber-border rounded-xl px-4 py-3">
      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${tone}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{title}</p>
        <p className="text-xs text-cyber-muted truncate">{detail}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );

  const btn =
    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
          <Inbox className="w-6 h-6 text-neon-purple" /> {t("inbox.title")}
        </h1>
        <p className="text-sm text-cyber-muted mt-1">{t("inbox.sub")}</p>
      </div>

      {/* Autopilot opt-in rides the inbox — it is the approval surface. */}
      {server && (
        <div className="flex items-center gap-3 bg-cyber-card border border-cyber-border rounded-xl px-4 py-3">
          <Sparkles className="w-4 h-4 text-fuchsia-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">{t("inbox.apTitle")}</p>
            <p className="text-xs text-cyber-muted">{t("inbox.apSub")}</p>
          </div>
          <button
            onClick={toggleAutopilot}
            disabled={apBusy}
            className={`${btn} ${
              server.autopilot
                ? "bg-success/10 border border-success/40 text-success"
                : "bg-cyber-dark border border-cyber-border text-cyber-muted hover:text-foreground"
            }`}
          >
            {server.autopilot ? t("inbox.apEnabled") : t("inbox.apEnable")}
          </button>
        </div>
      )}

      {total === 0 && server ? (
        <div className="text-center py-16">
          <CheckCircle className="w-10 h-10 text-success mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">{t("inbox.empty")}</p>
          <p className="text-xs text-cyber-muted mt-1">{t("inbox.emptySub")}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {server?.postsDraft.map((p) => (
            <Row
              key={p.id}
              icon={<Sparkles className="w-4 h-4 text-fuchsia-400" />}
              tone="bg-fuchsia-500/10 border-fuchsia-500/30"
              title={p.assetName}
              detail={`${t("inbox.draftFor")} ${p.platform} · ${p.scheduledAt.replace("T", " ")}`}
            >
              <button
                onClick={() => postAction("approvePost", p.id)}
                disabled={busyId === p.id}
                className={`${btn} bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90 flex items-center gap-1`}
              >
                <Check className="w-3.5 h-3.5" /> {t("inbox.approve")}
              </button>
              <button
                onClick={() => postAction("dismissPost", p.id)}
                disabled={busyId === p.id}
                aria-label={t("inbox.dismiss")}
                className={`${btn} bg-cyber-dark border border-cyber-border text-cyber-muted hover:text-foreground`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </Row>
          ))}

          {reviewProjects.map((p) => (
            <Row
              key={p.id}
              icon={<Film className="w-4 h-4 text-neon-purple" />}
              tone="bg-neon-purple/10 border-neon-purple/30"
              title={p.title}
              detail={t("inbox.projectReview")}
            >
              <button
                onClick={() => onApprove(p.id)}
                className={`${btn} bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90 flex items-center gap-1`}
              >
                <Check className="w-3.5 h-3.5" /> {t("dash.approvePublish")}
              </button>
            </Row>
          ))}

          {flaggedAssets.slice(0, 8).map((a) => (
            <Row
              key={a.id}
              icon={<ShieldAlert className="w-4 h-4 text-warning" />}
              tone="bg-warning/10 border-warning/30"
              title={a.name}
              detail={`${t("honesty.title")}: ${(a.flags ?? []).join(", ")}`}
            >
              <button
                onClick={() => onViewAsset(a)}
                className={`${btn} bg-cyber-dark border border-cyber-border text-foreground hover:border-warning/50`}
              >
                {t("inbox.review")}
              </button>
            </Row>
          ))}

          {server?.clipsReady.map((c) => (
            <Row
              key={c.id}
              icon={<Calendar className="w-4 h-4 text-electric-blue" />}
              tone="bg-electric-blue/10 border-electric-blue/30"
              title={c.title}
              detail={t("inbox.clipReady")}
            >
              <button
                onClick={() => go("Clips")}
                className={`${btn} bg-cyber-dark border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10`}
              >
                {t("inbox.schedule")}
              </button>
            </Row>
          ))}

          {server?.clipsFailed.map((c) => (
            <Row
              key={c.id}
              icon={<RefreshCw className="w-4 h-4 text-red-400" />}
              tone="bg-red-400/10 border-red-400/30"
              title={c.title}
              detail={`${t("inbox.renderFailed")}${c.error ? `: ${c.error.slice(0, 80)}` : ""}`}
            >
              <button
                onClick={() => go("Clips")}
                className={`${btn} bg-cyber-dark border border-cyber-border text-foreground hover:border-red-400/50`}
              >
                {t("inbox.open")}
              </button>
            </Row>
          ))}

          {server?.postsFailed.map((p) => (
            <Row
              key={p.id}
              icon={<ShieldAlert className="w-4 h-4 text-red-400" />}
              tone="bg-red-400/10 border-red-400/30"
              title={p.assetName}
              detail={`${t("inbox.publishBroken")} (${p.platform})`}
            >
              <button
                onClick={() => go("Schedule")}
                className={`${btn} bg-cyber-dark border border-cyber-border text-foreground hover:border-red-400/50`}
              >
                {t("inbox.open")}
              </button>
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}

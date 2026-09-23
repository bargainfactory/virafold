"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Film,
  BarChart3,
  Bell,
  Settings,
  Upload,
  Clock,
  CheckCircle,
  Eye,
  ThumbsUp,
  TrendingUp,
  Zap,
  LogOut,
  X,
  Trash2,
  FileVideo,
  Save,
  Check,
  Sparkles,
  Copy,
  FileText,
  Calendar,
  Send,
  Pencil,
  RefreshCw,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Fingerprint,
  Plus,
  ChevronLeft,
  ChevronRight,
  List,
  Lightbulb,
  Users,
  Recycle,
  Download,
  Mail,
  ExternalLink,
  DollarSign,
  Mic2,
  Gauge,
  Scissors,
  FlaskConical,
} from "lucide-react";
import type { Project, Asset } from "@/lib/data";
import IntegrationsPanel from "@/components/integrations-panel";
import BrandVoicePanel from "@/components/brand-voice-panel";
import ClipsTab from "@/components/clips-tab";
import SetupChecklist from "@/components/setup-checklist";
import WatchlistCard from "@/components/watchlist-card";
import SiteMonitorCard from "@/components/site-monitor-card";
import WordPressCard from "@/components/wordpress-card";
import ClientSwitcher from "@/components/client-switcher";
import ManagedClientsCard from "@/components/managed-clients-card";
import ExportCard from "@/components/export-card";
import {
  useConnections,
  isConnected,
  nextMorning,
  lastPlatform,
  rememberPlatform,
  PLATFORM_KEYS,
} from "@/lib/use-connections";

type Tab =
  | "Overview"
  | "Ideas"
  | "Projects"
  | "Clips"
  | "Upload"
  | "Schedule"
  | "Analytics"
  | "Audit"
  | "Audience"
  | "Business"
  | "Notifications"
  | "Settings";

const sidebarItems: { icon: typeof LayoutDashboard; label: Tab; tKey: string }[] = [
  { icon: Settings, label: "Settings", tKey: "dash.settings" },
  { icon: LayoutDashboard, label: "Overview", tKey: "dash.overview" },
  { icon: Lightbulb, label: "Ideas", tKey: "dash.ideas" },
  { icon: Upload, label: "Upload", tKey: "dash.upload" },
  { icon: Film, label: "Projects", tKey: "dash.projects" },
  { icon: Scissors, label: "Clips", tKey: "dash.clips" },
  { icon: Calendar, label: "Schedule", tKey: "dash.schedule" },
  { icon: BarChart3, label: "Analytics", tKey: "dash.analytics" },
  { icon: Gauge, label: "Audit", tKey: "dash.audit" },
  { icon: Users, label: "Audience", tKey: "dash.audience" },
  { icon: DollarSign, label: "Business", tKey: "dash.business" },
  { icon: Bell, label: "Notifications", tKey: "dash.notifications" },
];

// Twelve flat tabs exceed comfortable scanning; labeled groups make the same
// features read as a workflow. Settings leads — it is where accounts, keys,
// and brand voice live, the levers everything else depends on.
const sidebarGroups: { labelKey: string | null; tabs: Tab[] }[] = [
  { labelKey: null, tabs: ["Settings", "Overview"] },
  { labelKey: "dash.gCreate", tabs: ["Ideas", "Upload", "Projects", "Clips"] },
  { labelKey: "dash.gPublish", tabs: ["Schedule"] },
  { labelKey: "dash.gGrow", tabs: ["Analytics", "Audit", "Audience"] },
  { labelKey: "dash.gManage", tabs: ["Business", "Notifications"] },
];

/** Type-colored dot for asset preview cards — a scannable format cue. */
function assetTypeDot(type: string): string {
  const s = type.toLowerCase();
  if (s.includes("short")) return "bg-red-400";
  if (s.includes("tiktok")) return "bg-cyan-400";
  if (s.includes("reel")) return "bg-pink-400";
  if (s.includes("carousel")) return "bg-blue-400";
  if (s.includes("newsletter") || s.includes("email")) return "bg-neon-purple";
  if (s.includes("thread")) return "bg-sky-400";
  return "bg-cyber-muted";
}

// --- Client-side export helpers (no server round-trip needed) ---

function downloadBlob(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function assetsToCsv(assets: Asset[]): string {
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const rows = assets.map((a) =>
    [a.type, a.name, a.status, a.content ?? ""].map(esc).join(",")
  );
  return ["type,name,status,content", ...rows].join("\n");
}

/** Naive fixed-cadence SRT from asset text — a starting point for editing. */
function contentToSrt(content: string): string {
  const fmt = (secs: number) => {
    const h = String(Math.floor(secs / 3600)).padStart(2, "0");
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${h}:${m}:${s},000`;
  };
  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let tSec = 0;
  return lines
    .map((l, i) => {
      const start = tSec;
      tSec += 3;
      return `${i + 1}\n${fmt(start)} --> ${fmt(tSec)}\n${l}\n`;
    })
    .join("\n");
}

const statusColorMap: Record<string, string> = {
  uploading: "text-electric-blue bg-electric-blue/10",
  processing: "text-warning bg-warning/10",
  review: "text-neon-purple bg-neon-purple/10",
  published: "text-success bg-success/10",
  rejected: "text-red-400 bg-red-400/10",
};

export default function Dashboard() {
  const router = useRouter();
  const {
    user,
    ready,
    projects,
    assets,
    notifications,
    logout,
    uploadProject,
    approveProject,
    removeProject,
    toggleAssetLike,
    toggleAssetEvergreen,
    editAsset,
    regenerateAsset,
    addAssets,
    markNotificationRead,
    markAllNotificationsRead,
    addToast,
  } = useApp();
  const { t } = useTranslation();
  // The active tab lives in the URL hash (#Clips), so a refresh reloads the
  // page you were on with fresh data instead of dumping you back to Overview,
  // and back/forward walk your tab history.
  const [activeTab, setActiveTabState] = useState<Tab>("Overview");
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab);
    window.history.replaceState(null, "", `#${encodeURIComponent(tab)}`);
  }, []);
  useEffect(() => {
    const applyHash = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (sidebarItems.some((i) => i.label === h)) setActiveTabState(h as Tab);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTranscript, setUploadTranscript] = useState("");
  const [uploadUrl, setUploadUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [viewingAsset, setViewingAsset] = useState<Asset | null>(null);
  const [clipsProject, setClipsProject] = useState("");
  const connections = useConnections();
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [lint, setLint] = useState<{
    risk: "high" | "medium" | "low" | "clean";
    findings: { severity: string; category: string; term: string; snippet: string }[];
  } | null>(null);
  const [prov, setProv] = useState<{ engine: string; actions: number; valid: boolean } | null>(null);
  const [schedulePlatform, setSchedulePlatform] = useState(() => lastPlatform("TikTok"));
  const [scheduleAt, setScheduleAt] = useState(() => nextMorning());
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    email: "",
    notifications: true,
    autoPublish: false,
  });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogout = useCallback(() => {
    logout();
    router.push("/");
  }, [logout, router]);

  const resetUpload = useCallback(() => {
    setUploadFile(null);
    setUploadTranscript("");
    setUploading(false);
    setUploadPct(0);
  }, []);

  // Leaving edit/regenerate state behind when switching assets would apply it
  // to the wrong asset — reset whenever the viewer target changes.
  useEffect(() => {
    setEditDraft(null);
    setRegenFeedback("");
  }, [viewingAsset?.id]);

  // Policy lint and provenance track the asset's current text, so re-run after
  // edits and regenerations too (content in the dependency list), not just on open.
  useEffect(() => {
    setLint(null);
    setProv(null);
    if (!viewingAsset?.id) return;
    let active = true;
    fetch(`/api/assets/${viewingAsset.id}/lint`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d && setLint(d.lint))
      .catch(() => {});
    fetch(`/api/assets/${viewingAsset.id}/provenance`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d?.provenance) return;
        const actions: { engine?: string }[] = d.provenance.manifest.actions ?? [];
        const lastEngine =
          [...actions].reverse().find((a) => a.engine)?.engine ?? "—";
        setProv({ engine: lastEngine, actions: actions.length, valid: d.provenance.valid });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [viewingAsset?.id, viewingAsset?.content]);

  const handleSaveEdit = useCallback(async () => {
    if (!viewingAsset || editDraft === null) return;
    setSavingEdit(true);
    const updated = await editAsset(viewingAsset.id, { content: editDraft });
    setSavingEdit(false);
    if (updated) {
      setViewingAsset(updated);
      setEditDraft(null);
      addToast(t("asset.updated"));
    } else {
      addToast(t("asset.updateFailed"), "error");
    }
  }, [viewingAsset, editDraft, editAsset, addToast, t]);

  const handleRegenerate = useCallback(async () => {
    if (!viewingAsset || regenerating) return;
    setRegenerating(true);
    const updated = await regenerateAsset(viewingAsset.id, regenFeedback);
    setRegenerating(false);
    if (updated) {
      setViewingAsset(updated);
      setRegenFeedback("");
      setEditDraft(null);
      addToast(t("asset.regenDone"));
    } else {
      addToast(t("asset.regenFailed"), "error");
    }
  }, [viewingAsset, regenerating, regenFeedback, regenerateAsset, addToast, t]);

  const [abBusy, setAbBusy] = useState(false);
  const handleAbTest = useCallback(async () => {
    if (!viewingAsset || abBusy) return;
    setAbBusy(true);
    try {
      const res = await fetch(`/api/assets/${viewingAsset.id}/ab`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.variant) {
        addAssets([data.variant]);
        setViewingAsset({ ...viewingAsset, abGroup: data.original?.abGroup });
        addToast(t("asset.abCreated"));
      } else {
        addToast(data?.error || t("asset.abFailed"), "error");
      }
    } catch {
      addToast(t("asset.abFailed"), "error");
    } finally {
      setAbBusy(false);
    }
  }, [viewingAsset, abBusy, addAssets, addToast, t]);

  const handleSchedule = useCallback(async () => {
    if (!viewingAsset || !scheduleAt) return;
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId: viewingAsset.id,
        assetName: viewingAsset.name,
        platform: schedulePlatform,
        scheduledAt: scheduleAt,
      }),
    });
    if (res.ok) {
      rememberPlatform(schedulePlatform);
      addToast(`Scheduled to ${schedulePlatform}`);
      setViewingAsset(null);
      setScheduleAt(nextMorning());
    } else {
      addToast("Could not schedule", "error");
    }
  }, [viewingAsset, scheduleAt, schedulePlatform, addToast]);

  const handleGenerate = useCallback(async () => {
    if (!uploadFile && !uploadTranscript.trim() && !uploadUrl.trim()) return;
    setUploading(true);
    setUploadPct(0);
    const project = await uploadProject(
      uploadFile,
      uploadTranscript,
      setUploadPct,
      undefined,
      uploadUrl
    );
    setUploading(false);
    if (project) {
      setShowUploadModal(false);
      resetUpload();
      setUploadUrl("");
      setActiveTab("Projects");
    }
  }, [uploadFile, uploadTranscript, uploadUrl, uploadProject, resetUpload]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">{t("dash.pleaseSignIn")}</h2>
          <p className="text-cyber-muted mb-6">{t("dash.signInRequired")}</p>
          <Link
            href="/login"
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm"
          >
            {t("dash.goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 border-r border-cyber-border bg-cyber-dark flex-col">
        <div className="p-6 border-b border-cyber-border">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Virafold" className="w-8 h-8 rounded-full" />
            <span className="text-lg font-bold gradient-text">Virafold</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
          {sidebarGroups.map((group) => (
            <div key={group.labelKey ?? "top"}>
              {group.labelKey && (
                <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-cyber-muted/70">
                  {t(group.labelKey)}
                </p>
              )}
              {group.tabs.map((label) => {
                const item = sidebarItems.find((i) => i.label === label);
                if (!item) return null;
                return (
                  <button
                    key={item.label}
                    onClick={() => setActiveTab(item.label)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      activeTab === item.label
                        ? "bg-neon-purple/10 text-neon-purple"
                        : "text-cyber-muted hover:text-foreground hover:bg-cyber-card"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {t(item.tKey)}
                    {item.label === "Notifications" && unreadCount > 0 && (
                      <span className="ml-auto w-5 h-5 rounded-full bg-neon-purple text-white text-xs flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-cyber-border">
          {user.isAdmin && (
            <Link
              href="/admin"
              className="mb-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-amber-300/90 bg-amber-500/5 border border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40 transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              Operator Console
            </Link>
          )}
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-purple to-electric-blue flex items-center justify-center text-white text-xs font-bold">
              {user.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
              <p className="text-xs text-cyber-muted">{user.plan}</p>
            </div>
            <button onClick={handleLogout} className="text-cyber-muted hover:text-red-400 transition-colors" title={t("dash.logOut")}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main id="main" className="flex-1 overflow-auto">
        <header className="border-b border-cyber-border bg-cyber-dark/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {t(sidebarItems.find((i) => i.label === activeTab)?.tKey ?? activeTab)}
              </h1>
              <p className="text-sm text-cyber-muted">{t("dash.welcomeBack", { name: user.name })}</p>
            </div>
            <div className="flex items-center gap-2">
              <ClientSwitcher />
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {t("dash.newUpload")}
              </button>
            </div>
          </div>

          {/* Mobile tabs */}
          <div className="md:hidden flex gap-1 mt-4 overflow-x-auto pb-1">
            {sidebarItems.map((item) => (
              <button
                key={item.label}
                onClick={() => setActiveTab(item.label)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === item.label
                    ? "bg-neon-purple/10 text-neon-purple"
                    : "text-cyber-muted"
                }`}
              >
                {t(item.tKey)}
              </button>
            ))}
            {user.isAdmin && (
              <Link
                href="/admin"
                className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap text-amber-300/90 border border-amber-500/30"
              >
                Console
              </Link>
            )}
          </div>
        </header>

        <div className="p-6">
          <VerifyEmailBanner />
          {activeTab === "Overview" && (
            <OverviewTab
              projects={projects}
              assets={assets}
              onApprove={approveProject}
              onToggleLike={toggleAssetLike}
              onViewAll={() => setActiveTab("Projects")}
              onView={setViewingAsset}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === "Projects" && (
            <ProjectsTab
              projects={projects}
              assets={assets}
              onApprove={approveProject}
              onRemove={removeProject}
              onView={setViewingAsset}
              onClip={(id) => {
                setClipsProject(id);
                setActiveTab("Clips");
              }}
            />
          )}
          {activeTab === "Upload" && (
            <UploadTab
              onPickFile={(f) => {
                setUploadFile(f);
                setShowUploadModal(true);
              }}
              onStart={() => setShowUploadModal(true)}
            />
          )}
          {activeTab === "Ideas" && <IdeasTab />}
          {activeTab === "Clips" && (
            <ClipsTab
              initialProject={clipsProject}
              onNavigate={() => setActiveTab("Settings")}
              onUpload={() => setShowUploadModal(true)}
            />
          )}
          {activeTab === "Schedule" && (
            <ScheduleTab onNavigate={() => setActiveTab("Settings")} />
          )}
          {activeTab === "Analytics" && <AnalyticsTab />}
          {activeTab === "Audit" && (
            <>
              <AuditTab />
              <SiteMonitorCard />
              <WatchlistCard />
            </>
          )}
          {activeTab === "Audience" && <AudienceTab />}
          {activeTab === "Business" && <BusinessTab />}
          {activeTab === "Notifications" && (
            <NotificationsTab
              notifications={notifications}
              onMarkRead={markNotificationRead}
              onMarkAllRead={markAllNotificationsRead}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === "Settings" && (
            <>
              <SettingsTab
                user={user}
                form={settingsForm}
                setForm={setSettingsForm}
                saved={settingsSaved}
                onSave={() => {
                  setSettingsSaved(true);
                  addToast(t("dash.settingsSaved"));
                  setTimeout(() => setSettingsSaved(false), 2000);
                }}
              />
              <WordPressCard />
            </>
          )}
        </div>
      </main>

      {/* Upload / Generate Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !uploading && setShowUploadModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-cyber-card border border-cyber-border rounded-2xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-foreground">{t("dash.uploadContent")}</h3>
                <button
                  onClick={() => !uploading && setShowUploadModal(false)}
                  className="text-cyber-muted hover:text-foreground disabled:opacity-40"
                  disabled={uploading}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Optional media file */}
              <div
                className="border-2 border-dashed border-cyber-border hover:border-neon-purple/50 rounded-xl p-6 text-center cursor-pointer transition-colors mb-4"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) setUploadFile(e.dataTransfer.files[0]);
                }}
              >
                <FileVideo className="w-8 h-8 text-cyber-muted mx-auto mb-2" />
                {uploadFile ? (
                  <p className="text-sm text-foreground font-medium">{uploadFile.name}</p>
                ) : (
                  <>
                    <p className="text-sm text-foreground font-medium">{t("dash.dropFile")}</p>
                    <p className="text-xs text-cyber-muted">{t("dash.fileTypes")} · optional</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,audio/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && setUploadFile(e.target.files[0])}
              />

              {/* Transcript / script — drives generation */}
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("dash.transcriptLabel")}
              </label>
              <textarea
                value={uploadTranscript}
                onChange={(e) => setUploadTranscript(e.target.value)}
                placeholder={t("dash.transcriptPlaceholder")}
                rows={6}
                className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 resize-y"
              />
              <p className="text-xs text-cyber-muted mt-1.5 mb-4">{t("dash.transcriptHint")}</p>

              {/* Retention disclosure at the moment of upload */}
              <p className="text-[11px] text-cyber-muted -mt-2 mb-4">{t("dash.mediaRetention")}</p>

              {/* Wider input mouth: article/blog URL as the source */}
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("dash.sourceUrlLabel")}
              </label>
              <input
                type="url"
                value={uploadUrl}
                onChange={(e) => setUploadUrl(e.target.value)}
                placeholder="https://yourblog.com/post"
                className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 mb-4"
              />

              {uploading && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-cyber-muted mb-1">
                    <span>{uploadPct < 100 ? t("dash.uploadingLabel") : t("dash.generatingLabel")}</span>
                    <span>{uploadPct}%</span>
                  </div>
                  <div className="h-1.5 bg-cyber-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-neon-purple to-electric-blue transition-all"
                      style={{ width: `${uploadPct}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={uploading || (!uploadFile && !uploadTranscript.trim() && !uploadUrl.trim())}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {uploading ? t("dash.generatingLabel") : t("dash.generateBtn")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Asset viewer */}
      <AnimatePresence>
        {viewingAsset && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setViewingAsset(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-cyber-dark border border-cyber-border flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-neon-purple" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{viewingAsset.name}</p>
                    <p className="text-xs text-cyber-muted">{viewingAsset.type}</p>
                  </div>
                </div>
                <button onClick={() => setViewingAsset(null)} aria-label="Close" className="text-cyber-muted hover:text-foreground shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                {editDraft !== null ? (
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={14}
                    className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50 resize-y font-sans leading-relaxed"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/90 leading-relaxed">
                    {viewingAsset.content || "No content generated for this asset."}
                  </pre>
                )}
              </div>
              <div className="px-6 py-4 border-t border-cyber-border space-y-3">
                {/* Policy check */}
                {lint && (
                  <div
                    className={`rounded-lg border px-3 py-2.5 ${
                      lint.risk === "high"
                        ? "border-red-400/40 bg-red-400/5"
                        : lint.risk === "medium"
                          ? "border-warning/40 bg-warning/5"
                          : lint.risk === "low"
                            ? "border-electric-blue/30 bg-electric-blue/5"
                            : "border-success/30 bg-success/5"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {lint.risk === "clean" ? (
                        <ShieldCheck className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <ShieldAlert
                          className={`w-4 h-4 shrink-0 ${
                            lint.risk === "high"
                              ? "text-red-400"
                              : lint.risk === "medium"
                                ? "text-warning"
                                : "text-electric-blue"
                          }`}
                        />
                      )}
                      <span className="text-xs font-medium text-foreground">
                        {t("lint.title")}:{" "}
                        {lint.risk === "clean"
                          ? t("lint.clean")
                          : lint.risk === "high"
                            ? t("lint.riskHigh")
                            : lint.risk === "medium"
                              ? t("lint.riskMedium")
                              : t("lint.riskLow")}
                      </span>
                    </div>
                    {lint.findings.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {lint.findings.slice(0, 5).map((f, i) => (
                          <li key={`${f.term}-${i}`} className="text-[11px] text-cyber-muted leading-relaxed">
                            <span
                              className={`font-medium ${
                                f.severity === "high"
                                  ? "text-red-400"
                                  : f.severity === "medium"
                                    ? "text-warning"
                                    : "text-electric-blue"
                              }`}
                            >
                              {t(`lint.cat.${f.category}`)}
                            </span>{" "}
                            — “{f.term}”: {f.snippet}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Provenance */}
                {prov && (
                  <div className="flex items-center gap-2 text-[11px] text-cyber-muted">
                    <Fingerprint className="w-3.5 h-3.5 text-neon-purple shrink-0" />
                    <span>
                      {t("prov.title")}: {prov.engine} · {t("prov.actions", { count: prov.actions })} ·{" "}
                      <span className={prov.valid ? "text-success" : "text-red-400"}>
                        {prov.valid ? t("prov.sigValid") : t("prov.sigInvalid")}
                      </span>
                    </span>
                  </div>
                )}

                {/* Edit + regenerate */}
                <div className="flex flex-wrap items-center gap-2">
                  {editDraft === null ? (
                    <button
                      onClick={() => setEditDraft(viewingAsset.content || "")}
                      className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs font-medium text-foreground hover:border-neon-purple/50 transition-colors flex items-center gap-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5" /> {t("asset.edit")}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleSaveEdit}
                        disabled={savingEdit}
                        className="px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {savingEdit ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        {t("asset.editSave")}
                      </button>
                      <button
                        onClick={() => setEditDraft(null)}
                        disabled={savingEdit}
                        className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs text-cyber-muted hover:text-foreground transition-colors"
                      >
                        {t("asset.editCancel")}
                      </button>
                    </>
                  )}
                  <input
                    type="text"
                    value={regenFeedback}
                    onChange={(e) => setRegenFeedback(e.target.value)}
                    placeholder={t("asset.regenPh")}
                    maxLength={500}
                    className="flex-1 min-w-[160px] px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
                  />
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="px-3 py-2 rounded-lg bg-cyber-dark border border-neon-purple/40 text-xs font-medium text-neon-purple hover:bg-neon-purple/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
                    {regenerating ? t("asset.regenerating") : t("asset.regen")}
                  </button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[11px] text-cyber-muted mb-1">Platform</label>
                    <select
                      value={schedulePlatform}
                      onChange={(e) => setSchedulePlatform(e.target.value)}
                      className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                    >
                      {["TikTok", "YouTube", "LinkedIn", "X"].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-[11px] text-cyber-muted mb-1">Publish at</label>
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                    />
                  </div>
                  <button
                    onClick={handleSchedule}
                    disabled={!scheduleAt}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
                  >
                    <Calendar className="w-4 h-4" /> Schedule
                  </button>
                </div>
                {connections && !isConnected(connections, schedulePlatform) && (
                  <p className="text-[11px] text-warning flex flex-wrap items-center gap-1.5">
                    {PLATFORM_KEYS[schedulePlatform]
                      ? t("sched.demoNote", { platform: schedulePlatform })
                      : t("sched.demoNoteIg")}
                    {PLATFORM_KEYS[schedulePlatform] && (
                      <button
                        onClick={() => {
                          setViewingAsset(null);
                          setActiveTab("Settings");
                        }}
                        className="underline hover:text-foreground transition-colors"
                      >
                        {t("sched.connectNow")}
                      </button>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(viewingAsset.content || "");
                      addToast("Copied to clipboard");
                    }}
                    className="text-xs text-cyber-muted hover:text-foreground transition-colors flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy content
                  </button>
                  <button
                    onClick={() =>
                      downloadBlob(
                        `${viewingAsset.name.replace(/[^a-zA-Z0-9 _-]/g, "")}.srt`,
                        "text/plain",
                        contentToSrt(viewingAsset.content || "")
                      )
                    }
                    className="text-xs text-cyber-muted hover:text-foreground transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> {t("asset.srt")}
                  </button>
                  <button
                    onClick={handleAbTest}
                    disabled={abBusy || Boolean(viewingAsset.abGroup)}
                    title={t("asset.abHint")}
                    className={`text-xs transition-colors flex items-center gap-1.5 ${
                      viewingAsset.abGroup
                        ? "text-success"
                        : "text-cyber-muted hover:text-foreground"
                    } disabled:cursor-default`}
                  >
                    <FlaskConical className={`w-3.5 h-3.5 ${abBusy ? "animate-pulse" : ""}`} />
                    {viewingAsset.abGroup
                      ? t("asset.abActive")
                      : abBusy
                        ? t("asset.abCreating")
                        : t("asset.ab")}
                  </button>
                  <button
                    onClick={() => {
                      toggleAssetEvergreen(viewingAsset.id);
                      const next = !viewingAsset.evergreen;
                      setViewingAsset({ ...viewingAsset, evergreen: next });
                      addToast(next ? t("asset.evergreenSet") : t("asset.evergreenUnset"), "info");
                    }}
                    title={t("asset.evergreenHint")}
                    className={`text-xs transition-colors flex items-center gap-1.5 ${
                      viewingAsset.evergreen
                        ? "text-success hover:text-success/80"
                        : "text-cyber-muted hover:text-foreground"
                    }`}
                  >
                    <Recycle className="w-3.5 h-3.5" /> {t("asset.evergreen")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Overview Tab ---
function OverviewTab({
  projects,
  assets,
  onApprove,
  onToggleLike,
  onViewAll,
  onView,
  onNavigate,
}: {
  projects: Project[];
  assets: Asset[];
  onApprove: (id: string) => void;
  onToggleLike: (id: string) => void;
  onViewAll: () => void;
  onView: (asset: Asset) => void;
  onNavigate: (tab: Tab) => void;
}) {
  const { t } = useTranslation();
  const activeCount = projects.filter((p) => p.status === "processing" || p.status === "review").length;
  const publishedCount = projects.filter((p) => p.status === "published").length;

  const statusConfig: Record<string, { label: string; color: string }> = {
    uploading: { label: t("dash.uploading"), color: statusColorMap.uploading },
    processing: { label: t("dash.processing"), color: statusColorMap.processing },
    review: { label: t("dash.readyForReview"), color: statusColorMap.review },
    published: { label: t("dash.published"), color: statusColorMap.published },
    rejected: { label: t("dash.rejected"), color: statusColorMap.rejected },
  };

  return (
    <div className="space-y-6">
      {/* Live activation checklist replaces the old static onboarding banner. */}
      <SetupChecklist projects={projects} onNavigate={(tab) => onNavigate(tab as Tab)} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t("dashTeaser.activeProjects"), value: String(activeCount), icon: Clock, color: "text-warning" },
          { label: t("dash.totalAssets"), value: String(assets.length), icon: Film, color: "text-neon-purple" },
          { label: t("dash.published"), value: String(publishedCount), icon: CheckCircle, color: "text-success" },
          { label: t("dash.totalProjects"), value: String(projects.length), icon: TrendingUp, color: "text-electric-blue" },
        ].map((stat) => (
          <div key={stat.label} className="bg-cyber-card border border-cyber-border rounded-xl p-4">
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-cyber-muted mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-cyber-card border border-cyber-border rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <h2 className="font-semibold text-foreground">{t("dash.recentProjects")}</h2>
          <button onClick={onViewAll} className="text-xs text-neon-purple hover:underline">{t("dash.viewAll")}</button>
        </div>
        <div className="divide-y divide-cyber-border">
          {projects.slice(0, 4).map((project) => {
            const config = statusConfig[project.status] || statusConfig.processing;
            return (
              <div key={project.id} className="flex items-center gap-4 px-6 py-4 hover:bg-cyber-dark/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{project.title}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${config.color}`}>{config.label}</span>
                    <span className="text-xs text-cyber-muted">{project.assetsReady}/{project.assetsTotal} assets</span>
                  </div>
                </div>
                <div className="hidden sm:block w-40">
                  <div className="h-1.5 bg-cyber-border rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${project.status === "published" ? "bg-success" : "bg-gradient-to-r from-neon-purple to-electric-blue"}`}
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                </div>
                {project.status === "review" && (
                  <button
                    onClick={() => onApprove(project.id)}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90"
                  >
                    {t("dash.approvePublish")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-cyber-card border border-cyber-border rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <h2 className="font-semibold text-foreground">{t("dash.recentAssets")}</h2>
          {assets.length > 0 && (
            <button
              onClick={() => downloadBlob("virafold-assets.csv", "text/csv", assetsToCsv(assets))}
              className="text-xs text-neon-purple hover:underline flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> {t("dash.exportCsv")}
            </button>
          )}
        </div>
        <div className="divide-y divide-cyber-border">
          {assets.slice(0, 6).map((asset) => (
            <div key={asset.id} className="flex items-center gap-4 px-6 py-3 hover:bg-cyber-dark/30 transition-colors">
              <button
                onClick={() => onView(asset)}
                className="w-10 h-10 rounded-lg bg-cyber-dark border border-cyber-border flex items-center justify-center hover:border-neon-purple/50 transition-colors shrink-0"
                title="View asset"
              >
                <Eye className="w-4 h-4 text-cyber-muted" />
              </button>
              <button onClick={() => onView(asset)} className="flex-1 min-w-0 text-left">
                <p className="text-sm text-foreground truncate hover:text-neon-purple transition-colors">{asset.name}</p>
                <p className="text-xs text-cyber-muted">{asset.type}</p>
              </button>
              <span className="text-xs text-cyber-muted hidden sm:inline">{asset.views}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${asset.status === "live" || asset.status === "sent" ? "text-success bg-success/10" : "text-cyber-muted bg-cyber-dark"}`}>
                {asset.status}
              </span>
              <button onClick={() => onToggleLike(asset.id)} className="transition-colors">
                <ThumbsUp className={`w-4 h-4 ${asset.liked ? "text-neon-purple fill-neon-purple" : "text-cyber-muted hover:text-neon-purple"}`} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Projects Tab ---
function ProjectsTab({
  projects,
  assets,
  onApprove,
  onRemove,
  onView,
  onClip,
}: {
  projects: Project[];
  assets: Asset[];
  onApprove: (id: string) => void;
  onRemove: (id: string) => void;
  onView: (asset: Asset) => void;
  onClip: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const { addToast } = useApp();
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // Agency workflow: mint the project's client-approval link and copy it.
  const shareForApproval = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/share`, { method: "POST" });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.url) {
      navigator.clipboard?.writeText(d.url);
      addToast(t("proj.shareCopied"));
    } else {
      addToast(t("proj.shareFailed"), "error");
    }
  }, [addToast, t]);
  // The newest project starts expanded so fresh generations are immediately
  // previewable without an extra click.
  const [openId, setOpenId] = useState<string | null>(projects[0]?.id ?? null);
  const filtered = filter === "all" ? projects : projects.filter((p) => p.status === filter);

  // Cross-project asset search: typing switches the list to matching assets.
  const assetTypes = Array.from(new Set(assets.map((a) => a.type))).sort();
  const searching = query.trim().length > 0 || typeFilter !== "all";
  const q = query.trim().toLowerCase();
  const matches = searching
    ? assets.filter(
        (a) =>
          (typeFilter === "all" || a.type === typeFilter) &&
          (!q ||
            a.name.toLowerCase().includes(q) ||
            a.type.toLowerCase().includes(q) ||
            (a.content ?? "").toLowerCase().includes(q))
      )
    : [];

  const statusConfig: Record<string, { label: string; color: string }> = {
    uploading: { label: t("dash.uploading"), color: statusColorMap.uploading },
    processing: { label: t("dash.processing"), color: statusColorMap.processing },
    review: { label: t("dash.readyForReview"), color: statusColorMap.review },
    published: { label: t("dash.published"), color: statusColorMap.published },
    rejected: { label: t("dash.rejected"), color: statusColorMap.rejected },
  };

  const filterLabels: Record<string, string> = {
    all: t("blog.all"),
    processing: t("dash.processing"),
    review: t("dash.readyForReview"),
    published: t("dash.published"),
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 flex-wrap items-center">
        {["all", "processing", "review", "published"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              filter === f ? "bg-neon-purple/20 text-neon-purple border border-neon-purple/30" : "bg-cyber-card border border-cyber-border text-cyber-muted"
            }`}
          >
            {filterLabels[f] ?? f}
          </button>
        ))}
        <div className="flex gap-2 flex-1 min-w-[220px] sm:justify-end">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("proj.searchPh")}
            className="flex-1 sm:max-w-[220px] px-3 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-xs text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-xs text-cyber-muted focus:outline-none focus:border-neon-purple/50"
          >
            <option value="all">{t("proj.allTypes")}</option>
            {assetTypes.map((tp) => (
              <option key={tp} value={tp}>
                {tp}
              </option>
            ))}
          </select>
        </div>
      </div>

      {searching ? (
        <div>
          <p className="text-xs text-cyber-muted mb-3">
            {t("proj.results").replace("{n}", String(matches.length))}
          </p>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {matches.map((asset) => (
              <button
                key={asset.id}
                onClick={() => onView(asset)}
                className="text-left bg-cyber-card border border-cyber-border rounded-lg p-3 hover:border-neon-purple/50 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-neon-purple">
                    <span className={`w-1.5 h-1.5 rounded-full ${assetTypeDot(asset.type)}`} />
                    {asset.type}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-cyber-muted group-hover:text-foreground transition-colors">
                    <Eye className="w-3 h-3" /> {t("proj.preview")}
                  </span>
                </div>
                <p className="text-sm text-foreground font-medium line-clamp-1">{asset.name}</p>
                {asset.content && (
                  <p className="text-xs text-cyber-muted mt-1 line-clamp-2">{asset.content}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-cyber-muted">{t("dash.noProjects")}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((project) => {
            const config = statusConfig[project.status] || statusConfig.processing;
            const projAssets = assets.filter((a) => a.projectId === project.id);
            const open = openId === project.id;
            // Status-tinted icon tile + created date distinguish look-alike rows.
            const tile =
              project.status === "published"
                ? "bg-gradient-to-br from-success/25 to-success/5 border-success/40 text-success"
                : project.status === "review"
                  ? "bg-gradient-to-br from-neon-purple/30 to-electric-blue/15 border-neon-purple/40 text-neon-purple"
                  : "bg-gradient-to-br from-electric-blue/25 to-electric-blue/5 border-electric-blue/40 text-electric-blue";
            const dt = new Date(project.createdAt);
            const dateLabel = Number.isNaN(dt.getTime())
              ? null
              : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
            return (
              <div
                key={project.id}
                className={`bg-cyber-card border rounded-xl p-5 transition-colors ${
                  open ? "border-neon-purple/40" : "border-cyber-border hover:border-neon-purple/25"
                }`}
              >
                <div
                  className="flex items-start gap-4 cursor-pointer"
                  onClick={() => setOpenId(open ? null : project.id)}
                >
                  <div
                    className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${tile}`}
                  >
                    <FileVideo className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{project.title}</p>
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${config.color}`}>{config.label}</span>
                      {dateLabel && <span className="text-xs text-cyber-muted">{dateLabel}</span>}
                      {project.fileName && <span className="text-xs text-cyber-muted">{project.fileName}</span>}
                      {project.fileSize && <span className="text-xs text-cyber-muted">{project.fileSize}</span>}
                      {projAssets.length > 0 && (
                        <span className="text-xs text-neon-purple">
                          {projAssets.length} {t("proj.assetsWord")}
                        </span>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-cyber-muted mb-1">
                        <span>{project.assetsReady}/{project.assetsTotal} assets</span>
                        <span>{project.eta}</span>
                      </div>
                      <div className="h-1.5 bg-cyber-border rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${project.status === "published" ? "bg-success" : "bg-gradient-to-r from-neon-purple to-electric-blue"}`}
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        shareForApproval(project.id);
                      }}
                      title={t("proj.shareHint")}
                      className="hidden sm:flex p-1.5 text-cyber-muted hover:text-electric-blue transition-colors rounded-lg hover:bg-electric-blue/10"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    {project.fileName && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onClip(project.id);
                        }}
                        className="hidden sm:flex px-3 py-1.5 text-xs font-medium rounded-lg bg-cyber-dark border border-neon-purple/40 text-neon-purple hover:bg-neon-purple/10 transition-colors items-center gap-1.5"
                      >
                        <Scissors className="w-3 h-3" /> {t("proj.clip")}
                      </button>
                    )}
                    {project.status === "review" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onApprove(project.id);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90"
                      >
                        {t("dashTeaser.approve")}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(project.id);
                      }}
                      className="p-1.5 text-cyber-muted hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10"
                      title={t("dash.removeProject")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight
                      className={`w-4 h-4 text-cyber-muted transition-transform ${open ? "rotate-90" : ""}`}
                    />
                  </div>
                </div>

                {/* Asset previews: what this generation actually produced */}
                {open && (
                  <div className="mt-4 pt-4 border-t border-cyber-border/60">
                    {projAssets.length === 0 ? (
                      <p className="text-xs text-cyber-muted">{t("proj.noAssetsYet")}</p>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-2.5">
                        {projAssets.map((asset) => (
                          <button
                            key={asset.id}
                            onClick={() => onView(asset)}
                            className="text-left bg-cyber-dark border border-cyber-border rounded-lg p-3 hover:border-neon-purple/50 transition-colors group"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="flex items-center gap-1.5 text-[11px] font-medium text-neon-purple">
                    <span className={`w-1.5 h-1.5 rounded-full ${assetTypeDot(asset.type)}`} />
                    {asset.type}
                  </span>
                              <span className="flex items-center gap-1 text-[11px] text-cyber-muted group-hover:text-foreground transition-colors">
                                <Eye className="w-3 h-3" /> {t("proj.preview")}
                              </span>
                            </div>
                            <p className="text-sm text-foreground font-medium line-clamp-1">{asset.name}</p>
                            {asset.content && (
                              <p className="text-xs text-cyber-muted mt-1 line-clamp-2">{asset.content}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Upload Tab ---
function UploadTab({
  onPickFile,
  onStart,
}: {
  onPickFile: (file: File) => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="max-w-2xl mx-auto">
      <div
        className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-colors ${
          dragOver ? "border-neon-purple bg-neon-purple/5" : "border-cyber-border hover:border-cyber-muted"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.[0]) onPickFile(e.dataTransfer.files[0]);
        }}
      >
        <Upload className="w-16 h-16 text-cyber-muted mx-auto mb-6" />
        <h3 className="text-xl font-semibold text-foreground mb-2">{t("dash.uploadYourContent")}</h3>
        <p className="text-cyber-muted mb-6">{t("dash.dragDrop")}</p>
        <button
          onClick={(e) => { e.stopPropagation(); onStart(); }}
          className="px-6 py-2.5 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> {t("dash.generateBtn")}
        </button>
        <p className="text-xs text-cyber-muted mt-4">Supports: MP4, MOV, MP3, WAV — plus a pasted transcript/script</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
      />

      <div className="mt-8 bg-cyber-card border border-cyber-border rounded-xl p-6">
        <h4 className="font-medium text-foreground mb-4">{t("dash.whatHappens")}</h4>
        <div className="space-y-3">
          {[
            "Paste your transcript/script (or upload media for reference)",
            "The engine scores segments and extracts the strongest hooks",
            "Short-form clips are generated with hooks, captions & hashtags",
            "A LinkedIn carousel, newsletter, and X thread are drafted",
            "Everything lands in Projects for you to review",
            "Approve to publish — connect a key for AI-grade output",
          ].map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-neon-purple/10 text-neon-purple text-xs flex items-center justify-center font-bold shrink-0">
                {i + 1}
              </div>
              <span className="text-sm text-cyber-muted">{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Schedule Tab (calendar + list scheduling dashboard) ---
interface SchedPost {
  id: string;
  assetId: string;
  assetName: string;
  platform: string;
  scheduledAt: string;
  status: "scheduled" | "published" | "canceled";
}

const SCHED_PLATFORMS = ["TikTok", "YouTube", "LinkedIn", "X"];

const schedStatusColor: Record<string, string> = {
  scheduled: "text-warning bg-warning/10",
  published: "text-success bg-success/10",
  canceled: "text-cyber-muted bg-cyber-dark",
};

const schedChipColor: Record<string, string> = {
  scheduled: "bg-warning/15 text-warning border-warning/30",
  published: "bg-success/15 text-success border-success/30",
  canceled: "bg-cyber-dark text-cyber-muted border-cyber-border",
};

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function schedDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function ScheduleTab({ onNavigate }: { onNavigate: () => void }) {
  const { assets, addToast } = useApp();
  const { t, locale } = useTranslation();
  const connections = useConnections();
  const [posts, setPosts] = useState<SchedPost[]>([]);
  const [loading, setLoading] = useState(true);
  // Phones default to list view — a 7-column month grid is cramped there.
  const [view, setView] = useState<"calendar" | "list">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "calendar"
  );
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [selected, setSelected] = useState<SchedPost | null>(null);
  const [saving, setSaving] = useState(false);
  const [formAsset, setFormAsset] = useState("");
  const [formPlatform, setFormPlatform] = useState(() => lastPlatform("TikTok"));
  const [filling, setFilling] = useState(false);
  const [bestTimes, setBestTimes] = useState<Record<string, { hour: number; source: string }> | null>(null);

  useEffect(() => {
    fetch("/api/schedule/smart", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.bestTimes && setBestTimes(d.bestTimes))
      .catch(() => {});
  }, []);

  // One click distributes ready assets across the week at each platform's
  // best measured hour.
  const fillWeek = useCallback(async () => {
    setFilling(true);
    try {
      const res = await fetch("/api/schedule/smart", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.posts) {
        setPosts((prev) => [...d.posts, ...prev]);
        addToast(t("sched.fillDone", { count: String(d.posts.length) }));
      } else {
        addToast(d?.error ?? t("sched.fillFailed"), "error");
      }
    } finally {
      setFilling(false);
    }
  }, [addToast, t]);
  const [formAt, setFormAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toLocalInput(d);
  });
  const [editAt, setEditAt] = useState("");
  const [editPlatform, setEditPlatform] = useState("TikTok");
  const [metViews, setMetViews] = useState("");
  const [metLikes, setMetLikes] = useState("");
  const [metComments, setMetComments] = useState("");
  const [savingMetrics, setSavingMetrics] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/schedule", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d && setPosts(d.posts))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const openDetail = useCallback((p: SchedPost) => {
    setSelected(p);
    setEditPlatform(p.platform);
    const d = new Date(p.scheduledAt);
    setEditAt(Number.isNaN(d.getTime()) ? "" : toLocalInput(d));
    setMetViews("");
    setMetLikes("");
    setMetComments("");
  }, []);

  const saveResults = useCallback(async () => {
    if (!selected) return;
    setSavingMetrics(true);
    const res = await fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId: selected.id,
        views: Number(metViews) || 0,
        likes: Number(metLikes) || 0,
        comments: Number(metComments) || 0,
      }),
    });
    setSavingMetrics(false);
    if (res.ok) {
      setSelected(null);
      addToast(t("sched.resultsSaved"));
    } else {
      addToast(t("sched.toastFailed"), "error");
    }
  }, [selected, metViews, metLikes, metComments, addToast, t]);

  const createPost = useCallback(async () => {
    const asset = assets.find((a) => a.id === formAsset);
    if (!asset || !formAt) return;
    setSaving(true);
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId: asset.id,
        assetName: asset.name,
        platform: formPlatform,
        scheduledAt: formAt,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const { post } = await res.json();
      rememberPlatform(formPlatform);
      setPosts((prev) => [post, ...prev]);
      setComposerOpen(false);
      addToast(t("sched.toastScheduled", { platform: formPlatform }));
    } else {
      addToast(t("sched.toastFailed"), "error");
    }
  }, [assets, formAsset, formPlatform, formAt, addToast, t]);

  const act = useCallback(
    async (id: string, action: "publish" | "cancel") => {
      const res = await fetch(
        `/api/schedule/${id}${action === "cancel" ? "?action=cancel" : ""}`,
        { method: "POST" }
      );
      if (res.ok) {
        const d = await res.json();
        setPosts(d.posts);
        setSelected(null);
        if (action === "cancel") {
          addToast(t("sched.toastCanceled"));
        } else if (d.delivery?.ok) {
          addToast(t("sched.toastPublished"));
        } else if (d.delivery && !d.delivery.ok) {
          addToast(t("sched.toastDeliveryFailed"), "error");
        } else {
          addToast(t("sched.toastPublishedDemo"));
        }
      }
    },
    [addToast, t]
  );

  const reschedule = useCallback(async () => {
    if (!selected || !editAt) return;
    setSaving(true);
    const res = await fetch(`/api/schedule/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: editPlatform, scheduledAt: editAt }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      setPosts(d.posts);
      setSelected(null);
      addToast(t("sched.toastRescheduled"));
    } else {
      addToast(t("sched.toastFailed"), "error");
    }
  }, [selected, editAt, editPlatform, addToast, t]);

  // Month grid: 6 weeks starting on the Sunday on/before the 1st.
  const gridStart = new Date(month);
  gridStart.setDate(1 - month.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d.toLocaleDateString(locale, { weekday: "short" });
  });
  const byDay = new Map<string, SchedPost[]>();
  for (const p of posts) {
    const d = new Date(p.scheduledAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = schedDayKey(d);
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  const todayKey = schedDayKey(new Date());

  const upcoming = posts
    .filter((p) => p.status === "scheduled")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const past = posts
    .filter((p) => p.status !== "scheduled")
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
      </div>
    );
  }

  const listRow = (p: SchedPost) => (
    <div
      key={p.id}
      onClick={() => openDetail(p)}
      className="bg-cyber-card border border-cyber-border rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:border-neon-purple/40 transition-colors"
    >
      <div className="w-10 h-10 rounded-lg bg-cyber-dark border border-cyber-border flex items-center justify-center shrink-0">
        <Send className="w-4 h-4 text-neon-purple" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{p.assetName}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-xs text-cyber-muted">{p.platform}</span>
          <span className="text-xs text-cyber-muted">
            {new Date(p.scheduledAt).toLocaleString(locale)}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${schedStatusColor[p.status]}`}>
            {t(`sched.status.${p.status}`)}
          </span>
        </div>
      </div>
      {p.status === "scheduled" && (
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => act(p.id, "publish")}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90"
          >
            {t("sched.publishNow")}
          </button>
          <button
            onClick={() => act(p.id, "cancel")}
            className="px-3 py-1.5 text-xs rounded-lg bg-cyber-dark border border-cyber-border text-cyber-muted hover:text-red-400"
          >
            {t("sched.cancelPost")}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-cyber-muted">{t("sched.intro")}</p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-cyber-border overflow-hidden">
            <button
              onClick={() => setView("calendar")}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                view === "calendar" ? "bg-neon-purple/15 text-neon-purple" : "text-cyber-muted hover:text-foreground"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" /> {t("sched.calendar")}
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                view === "list" ? "bg-neon-purple/15 text-neon-purple" : "text-cyber-muted hover:text-foreground"
              }`}
            >
              <List className="w-3.5 h-3.5" /> {t("sched.list")}
            </button>
          </div>
          <button
            onClick={fillWeek}
            disabled={filling}
            title={t("sched.fillHint")}
            className="px-4 py-2 rounded-xl bg-cyber-dark border border-neon-purple/40 text-neon-purple text-sm font-medium hover:bg-neon-purple/10 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {filling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {t("sched.fillWeek")}
          </button>
          <button
            onClick={() => setComposerOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> {t("sched.new")}
          </button>
        </div>
      </div>

      {view === "calendar" ? (
        <div className="bg-cyber-card border border-cyber-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-cyber-border">
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="p-1.5 rounded-lg text-cyber-muted hover:text-foreground hover:bg-cyber-dark transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-foreground capitalize">
              {month.toLocaleDateString(locale, { month: "long", year: "numeric" })}
            </span>
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="p-1.5 rounded-lg text-cyber-muted hover:text-foreground hover:bg-cyber-dark transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 border-b border-cyber-border">
            {weekdays.map((w) => (
              <div key={w} className="px-2 py-2 text-center text-[11px] font-medium text-cyber-muted capitalize">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const key = schedDayKey(d);
              const inMonth = d.getMonth() === month.getMonth();
              const dayPosts = byDay.get(key) ?? [];
              return (
                <div
                  key={i}
                  className={`min-h-[92px] p-1.5 border-b border-r border-cyber-border/60 ${
                    inMonth ? "" : "opacity-40"
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 text-[11px] rounded-full mb-1 ${
                      key === todayKey
                        ? "bg-neon-purple text-white font-bold"
                        : "text-cyber-muted"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => openDetail(p)}
                        title={`${p.assetName} — ${p.platform}`}
                        className={`w-full text-left px-1.5 py-0.5 rounded border text-[10px] leading-tight truncate ${schedChipColor[p.status]}`}
                      >
                        {p.platform} · {p.assetName}
                      </button>
                    ))}
                    {dayPosts.length > 3 && (
                      <span className="block text-[10px] text-cyber-muted px-1.5">
                        +{dayPosts.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-cyber-muted">{t("sched.empty")}</div>
      ) : (
        <div className="space-y-5">
          {upcoming.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-cyber-muted">
                {t("sched.upcoming")}
              </h3>
              {upcoming.map(listRow)}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-cyber-muted">
                {t("sched.past")}
              </h3>
              {past.map(listRow)}
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <AnimatePresence>
        {composerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setComposerOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-cyber-card border border-cyber-border rounded-2xl p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-foreground">{t("sched.new")}</h3>
                <button onClick={() => setComposerOpen(false)} aria-label="Close" className="text-cyber-muted hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {assets.length === 0 ? (
                <p className="text-sm text-cyber-muted py-6 text-center">{t("sched.noAssets")}</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-cyber-muted mb-1.5">{t("sched.asset")}</label>
                    <select
                      value={formAsset}
                      onChange={(e) => setFormAsset(e.target.value)}
                      className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                    >
                      <option value="">{t("sched.chooseAsset")}</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.type} — {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-cyber-muted mb-1.5">Platform</label>
                      <select
                        value={formPlatform}
                        onChange={(e) => setFormPlatform(e.target.value)}
                        className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                      >
                        {SCHED_PLATFORMS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-cyber-muted mb-1.5">{t("sched.when")}</label>
                      <input
                        type="datetime-local"
                        value={formAt}
                        onChange={(e) => setFormAt(e.target.value)}
                        className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                      />
                    </div>
                  </div>
                  {bestTimes?.[formPlatform] && (
                    <p className="text-[11px] text-electric-blue">
                      {t("sched.bestTime", {
                        platform: formPlatform,
                        hour: `${bestTimes[formPlatform].hour}:00`,
                        source: bestTimes[formPlatform].source,
                      })}
                    </p>
                  )}
                  {connections && !isConnected(connections, formPlatform) && (
                    <p className="text-[11px] text-warning flex flex-wrap items-center gap-1.5">
                      {PLATFORM_KEYS[formPlatform]
                        ? t("sched.demoNote", { platform: formPlatform })
                        : t("sched.demoNoteIg")}
                      {PLATFORM_KEYS[formPlatform] && (
                        <button
                          onClick={onNavigate}
                          className="underline hover:text-foreground transition-colors"
                        >
                          {t("sched.connectNow")}
                        </button>
                      )}
                    </p>
                  )}
                  <button
                    onClick={createPost}
                    disabled={saving || !formAsset || !formAt}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                    {t("sched.confirm")}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail / reschedule */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-cyber-card border border-cyber-border rounded-2xl p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{selected.assetName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-cyber-muted">{selected.platform}</span>
                    <span className="text-xs text-cyber-muted">
                      {new Date(selected.scheduledAt).toLocaleString(locale)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${schedStatusColor[selected.status]}`}>
                      {t(`sched.status.${selected.status}`)}
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} aria-label="Close" className="text-cyber-muted hover:text-foreground shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {selected.status === "published" && (
                <div className="space-y-3">
                  <p className="text-xs text-cyber-muted">{t("sched.resultsTitle")}</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: t("sched.views"), val: metViews, set: setMetViews },
                      { label: t("sched.likes"), val: metLikes, set: setMetLikes },
                      { label: t("sched.comments"), val: metComments, set: setMetComments },
                    ].map((f) => (
                      <div key={f.label}>
                        <label className="block text-xs text-cyber-muted mb-1.5">{f.label}</label>
                        <input
                          type="number"
                          min={0}
                          value={f.val}
                          onChange={(e) => f.set(e.target.value)}
                          placeholder="0"
                          className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={saveResults}
                    disabled={savingMetrics || (!metViews && !metLikes && !metComments)}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {savingMetrics ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                    {t("sched.saveResults")}
                  </button>
                </div>
              )}

              {selected.status === "scheduled" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-cyber-muted mb-1.5">Platform</label>
                      <select
                        value={editPlatform}
                        onChange={(e) => setEditPlatform(e.target.value)}
                        className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                      >
                        {SCHED_PLATFORMS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-cyber-muted mb-1.5">{t("sched.when")}</label>
                      <input
                        type="datetime-local"
                        value={editAt}
                        onChange={(e) => setEditAt(e.target.value)}
                        className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                      />
                    </div>
                  </div>
                  <button
                    onClick={reschedule}
                    disabled={saving || !editAt}
                    className="w-full py-2.5 rounded-xl bg-cyber-dark border border-neon-purple/40 text-neon-purple font-medium text-sm hover:bg-neon-purple/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                    {t("sched.reschedule")}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => act(selected.id, "publish")}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <Send className="w-4 h-4" /> {t("sched.publishNow")}
                    </button>
                    <button
                      onClick={() => act(selected.id, "cancel")}
                      className="flex-1 py-2.5 rounded-xl bg-cyber-dark border border-cyber-border text-cyber-muted text-sm hover:text-red-400 transition-colors"
                    >
                      {t("sched.cancelPost")}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Connected accounts (creator platform OAuth) ---
const CONN_LABELS: Record<string, string> = {
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
};

interface ConnRow {
  platform: string;
  configured: boolean;
  connected: boolean;
  handle: string | null;
}

function ConnectedAccountsCard() {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [rows, setRows] = useState<ConnRow[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/connect", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRows(d.platforms))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const disconnect = useCallback(
    async (platform: string) => {
      const res = await fetch(`/api/connect/${platform}/disconnect`, { method: "POST" });
      if (res.ok) {
        addToast(t("conn.disconnected"), "info");
        load();
      }
    },
    [addToast, t, load]
  );

  if (!rows) return null;

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Send className="w-4 h-4 text-neon-purple" />
        <h3 className="font-semibold text-foreground">{t("conn.title")}</h3>
      </div>
      <p className="text-xs text-cyber-muted mb-4">{t("conn.desc")}</p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.platform}
            className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-cyber-dark border border-cyber-border"
          >
            <div className="flex-1 min-w-[140px]">
              <p className="text-sm font-medium text-foreground">
                {CONN_LABELS[r.platform] ?? r.platform}
              </p>
              {r.connected && r.handle && (
                <p className="text-xs text-cyber-muted">{r.handle}</p>
              )}
            </div>
            {r.connected ? (
              <>
                <span className="text-xs px-2 py-0.5 rounded-full text-success bg-success/10">
                  {t("conn.connected")}
                </span>
                <button
                  onClick={() => disconnect(r.platform)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-cyber-card border border-cyber-border text-cyber-muted hover:text-red-400 transition-colors"
                >
                  {t("conn.disconnect")}
                </button>
              </>
            ) : r.configured ? (
              <a
                href={`/api/connect/${r.platform}/start`}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90"
              >
                {t("conn.connect")}
              </a>
            ) : (
              <span className="text-xs text-cyber-muted">{t("conn.notConfigured")}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Ideas Tab (backlog: idea → script → assets) ---
interface IdeaRow {
  id: string;
  title: string;
  notes: string;
  script: string;
  score: number;
  status: "idea" | "scripted" | "generated";
  createdAt: string;
}

const ideaStatusColor: Record<string, string> = {
  idea: "text-electric-blue bg-electric-blue/10",
  scripted: "text-warning bg-warning/10",
  generated: "text-success bg-success/10",
};

function IdeasTab() {
  const { uploadProject, addToast } = useApp();
  const { t } = useTranslation();
  const [ideas, setIdeas] = useState<IdeaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scriptIdea, setScriptIdea] = useState<IdeaRow | null>(null);
  const [scriptDraft, setScriptDraft] = useState("");
  const [savingScript, setSavingScript] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d && setIdeas(d.ideas))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const patchIdea = useCallback((idea: IdeaRow) => {
    setIdeas((prev) => prev.map((i) => (i.id === idea.id ? idea : i)));
  }, []);

  const addIdea = useCallback(async () => {
    if (!title.trim()) return;
    setAdding(true);
    const res = await fetch("/api/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), notes: notes.trim() }),
    });
    setAdding(false);
    if (res.ok) {
      const { idea } = await res.json();
      setIdeas((prev) => [idea, ...prev]);
      setTitle("");
      setNotes("");
    }
  }, [title, notes]);

  const writeScript = useCallback(
    async (idea: IdeaRow) => {
      setBusyId(idea.id);
      const res = await fetch(`/api/ideas/${idea.id}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: localStorage.getItem("ef_locale") || "en" }),
      });
      setBusyId(null);
      if (res.ok) {
        const { idea: updated } = await res.json();
        patchIdea(updated);
        setScriptIdea(updated);
        setScriptDraft(updated.script);
      } else {
        const d = await res.json().catch(() => null);
        addToast(d?.error ?? t("ideas.scriptFailed"), "error");
      }
    },
    [patchIdea, addToast, t]
  );

  // Script-to-video: TTS narration + waveform + captions, no recording.
  const makeVideo = useCallback(
    async (idea: IdeaRow) => {
      if (!idea.script) return;
      setBusyId(idea.id);
      const res = await fetch("/api/script-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: idea.title, script: idea.script }),
      });
      setBusyId(null);
      const d = await res.json().catch(() => null);
      if (res.ok) addToast(t("ideas.videoQueued"));
      else addToast(d?.error ?? t("ideas.videoFailed"), "error");
    },
    [addToast, t]
  );

  const saveScript = useCallback(async () => {
    if (!scriptIdea) return;
    setSavingScript(true);
    const res = await fetch(`/api/ideas/${scriptIdea.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: scriptDraft }),
    });
    setSavingScript(false);
    if (res.ok) {
      const { idea } = await res.json();
      patchIdea(idea);
      addToast(t("ideas.scriptSaved"));
    }
  }, [scriptIdea, scriptDraft, patchIdea, addToast, t]);

  const genAssets = useCallback(
    async (idea: IdeaRow) => {
      setBusyId(idea.id);
      const transcript = idea.script || `${idea.title}\n${idea.notes}`;
      const project = await uploadProject(null, transcript, undefined, idea.title);
      if (project) {
        const res = await fetch(`/api/ideas/${idea.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "generated" }),
        });
        if (res.ok) {
          const { idea: updated } = await res.json();
          patchIdea(updated);
        }
        setScriptIdea(null);
        addToast(t("ideas.assetsQueued"));
      }
      setBusyId(null);
    },
    [uploadProject, patchIdea, addToast, t]
  );

  const remove = useCallback(
    async (id: string) => {
      setIdeas((prev) => prev.filter((i) => i.id !== id));
      addToast(t("ideas.deleted"), "info");
      await fetch(`/api/ideas/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [addToast, t]
  );

  return (
    <div className="space-y-5">
      {/* The pipeline, spelled out: what to do, what the score means, and
          what each button produces — mirrors the actual controls below. */}
      <div className="bg-cyber-card border border-neon-purple/30 rounded-xl p-5">
        <p className="text-sm font-semibold text-foreground mb-4">{t("ideas.ctaTitle")}</p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="flex gap-3">
            <span className="w-8 h-8 rounded-lg bg-neon-purple/20 border border-neon-purple/40 text-neon-purple text-sm font-bold flex items-center justify-center shrink-0">
              8
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">{t("ideas.ctaS1t")}</p>
              <p className="text-xs text-cyber-muted mt-0.5 leading-relaxed">{t("ideas.ctaS1d")}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-8 h-8 rounded-lg bg-cyber-dark border border-cyber-border flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-electric-blue" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">{t("ideas.ctaS2t")}</p>
              <p className="text-xs text-cyber-muted mt-0.5 leading-relaxed">{t("ideas.ctaS2d")}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-8 h-8 rounded-lg bg-cyber-dark border border-cyber-border flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-neon-purple" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">{t("ideas.ctaS3t")}</p>
              <p className="text-xs text-cyber-muted mt-0.5 leading-relaxed">{t("ideas.ctaS3d")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-cyber-card border border-cyber-border rounded-xl p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            {t("ideas.titleLabel")}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addIdea()}
            placeholder={t("ideas.placeholder")}
            maxLength={200}
            className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
          />
        </div>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("ideas.notesLabel")}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addIdea()}
              placeholder={t("ideas.notesPh")}
              maxLength={2000}
              className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
            />
          </div>
          <button
            onClick={addIdea}
            disabled={adding || !title.trim()}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t("ideas.add")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
        </div>
      ) : ideas.length === 0 ? (
        <div className="text-center py-16 text-cyber-muted">{t("ideas.empty")}</div>
      ) : (
        <div className="space-y-3">
          {ideas.map((idea) => (
            <div
              key={idea.id}
              className="bg-cyber-card border border-cyber-border rounded-xl p-4 flex items-start gap-4"
            >
              <div
                title={t("ideas.scoreHint")}
                className="w-10 h-10 rounded-xl bg-neon-purple/10 border border-neon-purple/30 flex items-center justify-center shrink-0 text-sm font-bold text-neon-purple"
              >
                {idea.score}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{idea.title}</p>
                {idea.notes && (
                  <p className="text-xs text-cyber-muted mt-0.5 line-clamp-2">{idea.notes}</p>
                )}
                <span
                  className={`inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full ${ideaStatusColor[idea.status]}`}
                >
                  {t(`ideas.status.${idea.status}`)}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <button
                  onClick={() =>
                    idea.script
                      ? (setScriptIdea(idea), setScriptDraft(idea.script))
                      : writeScript(idea)
                  }
                  disabled={busyId === idea.id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-electric-blue/10 border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {busyId === idea.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  {idea.script ? t("ideas.viewScript") : t("ideas.writeScript")}
                </button>
                <button
                  onClick={() => genAssets(idea)}
                  disabled={busyId === idea.id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" /> {t("ideas.genAssets")}
                </button>
                <button
                  onClick={() => makeVideo(idea)}
                  disabled={busyId === idea.id || !idea.script}
                  title={idea.script ? t("ideas.makeVideoHint") : t("ideas.makeVideoNeedsScript")}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/40 text-fuchsia-400 hover:bg-fuchsia-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Film className="w-3.5 h-3.5" /> {t("ideas.makeVideo")}
                </button>
                <button
                  onClick={() => remove(idea.id)}
                  className="p-1.5 text-cyber-muted hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Script editor modal */}
      <AnimatePresence>
        {scriptIdea && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setScriptIdea(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {t("ideas.scriptTitle")}: {scriptIdea.title}
                  </p>
                </div>
                <button
                  onClick={() => setScriptIdea(null)}
                  className="text-cyber-muted hover:text-foreground shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <textarea
                  value={scriptDraft}
                  onChange={(e) => setScriptDraft(e.target.value)}
                  rows={16}
                  className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50 resize-y leading-relaxed"
                />
              </div>
              <div className="px-6 py-4 border-t border-cyber-border flex flex-wrap gap-2">
                <button
                  onClick={saveScript}
                  disabled={savingScript}
                  className="px-4 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-sm text-foreground hover:border-neon-purple/50 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {savingScript ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {t("asset.editSave")}
                </button>
                <button
                  onClick={() => genAssets(scriptIdea)}
                  disabled={busyId === scriptIdea.id}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                >
                  {busyId === scriptIdea.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {t("ideas.genAssets")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Audience Tab (subscribers, public page, media kit, broadcast) ---
interface SubRow {
  id: string;
  email: string;
  source: string;
  createdAt: string;
}

function AudienceTab() {
  const { assets, addToast } = useApp();
  const { t, locale } = useTranslation();
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [linksText, setLinksText] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [pageSaved, setPageSaved] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  const [broadcastAsset, setBroadcastAsset] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [referral, setReferral] = useState<{ link: string; count: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/referral", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d && setReferral({ link: d.link, count: d.count }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/subscribers", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/page", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([s, p]) => {
        if (!active) return;
        if (s) setSubs(s.subscribers);
        if (p?.page) {
          setSlug(p.page.slug);
          setDisplayName(p.page.displayName);
          setBio(p.page.bio);
          setLinksText(
            (p.page.links as { label: string; url: string }[])
              .map((l) => `${l.label} | ${l.url}`)
              .join("\n")
          );
          const r: Record<string, string> = {};
          (p.page.rates as { platform: string; price: number }[]).forEach(
            (x) => (r[x.platform] = String(x.price))
          );
          setRates(r);
          setPageSaved(true);
        }
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const savePage = useCallback(async () => {
    setSavingPage(true);
    const links = linksText
      .split("\n")
      .map((line) => {
        const [label, ...rest] = line.split("|");
        return { label: (label ?? "").trim(), url: rest.join("|").trim() };
      })
      .filter((l) => l.label && l.url);
    const ratesArr = Object.entries(rates)
      .map(([platform, price]) => ({ platform, price: Number(price) || 0 }))
      .filter((r) => r.price > 0);
    const res = await fetch("/api/page", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, displayName, bio, links, rates: ratesArr }),
    });
    setSavingPage(false);
    if (res.ok) {
      setPageSaved(true);
      addToast(t("aud.saved"));
    } else {
      const d = await res.json().catch(() => null);
      addToast(d?.error ?? t("aud.saveFailed"), "error");
    }
  }, [slug, displayName, bio, linksText, rates, addToast, t]);

  const exportCsv = useCallback(() => {
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "email,source,subscribed_at",
      ...subs.map((s) => [s.email, s.source, s.createdAt].map(esc).join(",")),
    ].join("\n");
    downloadBlob("subscribers.csv", "text/csv", csv);
  }, [subs]);

  const runImport = useCallback(async () => {
    if (!importText.trim()) return;
    setImporting(true);
    const res = await fetch("/api/subscribers/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: importText }),
    });
    setImporting(false);
    if (res.ok) {
      const d = await res.json();
      addToast(t("aud.importDone", { added: d.added, skipped: d.skipped }));
      setImportOpen(false);
      setImportText("");
      fetch("/api/subscribers", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d2) => d2 && setSubs(d2.subscribers))
        .catch(() => {});
    } else {
      const d = await res.json().catch(() => null);
      addToast(d?.error ?? t("sched.toastFailed"), "error");
    }
  }, [importText, addToast, t]);

  const broadcast = useCallback(async () => {
    if (!broadcastAsset) return;
    setBroadcasting(true);
    const res = await fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: broadcastAsset }),
    });
    setBroadcasting(false);
    const d = await res.json().catch(() => null);
    if (res.ok && d) {
      addToast(
        d.demo
          ? t("aud.broadcastDemo", { count: d.subscribers })
          : t("aud.broadcastSent", { count: d.sent })
      );
    } else {
      addToast(d?.error ?? t("aud.broadcastFailed"), "error");
    }
  }, [broadcastAsset, addToast, t]);

  // Newsletter-type assets first in the broadcast picker.
  const broadcastChoices = [...assets].sort((a, b) => {
    const an = /news/i.test(a.type) ? 0 : 1;
    const bn = /news/i.test(b.type) ? 0 : 1;
    return an - bn;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
      </div>
    );
  }

  const field = "w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50";

  return (
    <div className="space-y-6">
      <p className="text-sm text-cyber-muted">{t("aud.intro")}</p>

      {/* Subscribers */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-purple" />
            <h2 className="font-semibold text-foreground">
              {t("aud.subscribers")} · {subs.length}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setImportOpen((v) => !v)}
              className="text-xs text-neon-purple hover:underline flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" /> {t("aud.import")}
            </button>
            {subs.length > 0 && (
              <button
                onClick={exportCsv}
                className="text-xs text-neon-purple hover:underline flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> {t("aud.exportCsv")}
              </button>
            )}
          </div>
        </div>
        {importOpen && (
          <div className="px-6 py-4 border-b border-cyber-border space-y-3">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
              placeholder={t("aud.importPh")}
              className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-xs font-mono text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 resize-y"
            />
            <button
              onClick={runImport}
              disabled={importing || !importText.trim()}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {t("aud.import")}
            </button>
          </div>
        )}
        {subs.length === 0 ? (
          <p className="px-6 py-8 text-sm text-cyber-muted text-center">{t("aud.noSubs")}</p>
        ) : (
          <div className="divide-y divide-cyber-border max-h-72 overflow-y-auto">
            {subs.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-6 py-3 gap-3">
                <span className="text-sm text-foreground truncate">{s.email}</span>
                <span className="text-xs text-cyber-muted shrink-0">
                  {s.source} · {new Date(s.createdAt).toLocaleDateString(locale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Public page + media kit */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-foreground">{t("aud.pageTitle")}</h2>
          {pageSaved && slug && (
            <div className="flex items-center gap-3">
              <a
                href={`/c/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-neon-purple hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> {t("aud.view")}
              </a>
              <a
                href={`/kit/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-neon-purple hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> {t("aud.viewKit")}
              </a>
            </div>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-cyber-muted mb-1.5">{t("aud.slug")}</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-cyber-muted shrink-0">/c/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="your-name"
                maxLength={30}
                className={field}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-cyber-muted mb-1.5">{t("aud.displayName")}</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              className={field}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-cyber-muted mb-1.5">{t("aud.bio")}</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            maxLength={500}
            className={`${field} resize-y`}
          />
        </div>
        <div>
          <label className="block text-sm text-cyber-muted mb-1.5">{t("aud.links")}</label>
          <textarea
            value={linksText}
            onChange={(e) => setLinksText(e.target.value)}
            rows={3}
            placeholder={"YouTube | https://youtube.com/@you\nNewsletter | https://your.site"}
            className={`${field} resize-y font-mono text-xs`}
          />
        </div>
        <div>
          <label className="block text-sm text-cyber-muted mb-1.5">{t("aud.rates")}</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {SCHED_PLATFORMS.map((p) => (
              <div key={p}>
                <span className="block text-[11px] text-cyber-muted mb-1">{p}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-cyber-muted">$</span>
                  <input
                    type="number"
                    min={0}
                    value={rates[p] ?? ""}
                    onChange={(e) => setRates({ ...rates, [p]: e.target.value })}
                    className="w-full px-2 py-1.5 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={savePage}
          disabled={savingPage || !slug || !displayName.trim()}
          className="px-5 py-2 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        >
          {savingPage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t("aud.save")}
        </button>
      </div>

      {/* Referral loop */}
      {referral && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground">{t("aud.referral")}</h2>
              <p className="text-xs text-cyber-muted mt-1">{t("aud.referralDesc")}</p>
              <p className="text-xs text-neon-purple mt-2">
                {t("aud.referralCount", { count: referral.count })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground max-w-[260px] truncate">
                {referral.link}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(referral.link);
                  addToast(t("aud.copied"));
                }}
                className="px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Newsletter broadcast */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-neon-purple" />
          <h2 className="font-semibold text-foreground">{t("aud.broadcast")}</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={broadcastAsset}
            onChange={(e) => setBroadcastAsset(e.target.value)}
            className="flex-1 min-w-[220px] px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            <option value="">{t("aud.broadcastPick")}</option>
            {broadcastChoices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.type} — {a.name}
              </option>
            ))}
          </select>
          <button
            onClick={broadcast}
            disabled={broadcasting || !broadcastAsset || subs.length === 0}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
          >
            {broadcasting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {t("aud.broadcastSend", { count: subs.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Audit Tab (social audit + virality coach) ---
interface AuditReportUi {
  source: string;
  label: string;
  createdAt: string;
  posts: number;
  totalViews: number;
  avgViews: number;
  engagementRate: number;
  grade: number;
  sections: { key: string; score: number; note: string }[];
  findings: string[];
  top: { title: string; views: number; likes: number; comments: number; hint: string }[];
  bottom: { title: string; views: number; likes: number; comments: number; hint: string }[];
  bestDay: string | null;
  llm: {
    engine: string;
    insights: string[];
    rewrites: { original: string; improved: string }[];
    plan: string[];
  } | null;
}

function AuditTab() {
  const { addToast } = useApp();
  const { t, locale } = useTranslation();
  const [report, setReport] = useState<AuditReportUi | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [src, setSrc] = useState<"youtube" | "csv">("youtube");
  const [handle, setHandle] = useState("");
  const [csv, setCsv] = useState("");
  const [sendingIdeas, setSendingIdeas] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/audit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d?.report && setReport(d.report))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    const body =
      src === "youtube" ? { source: "youtube", handle } : { source: "csv", text: csv };
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setRunning(false);
    const d = await res.json().catch(() => null);
    if (res.ok && d?.report) {
      setReport(d.report);
      addToast(t("adt.seeded"));
    } else {
      const err = d?.error;
      addToast(
        err === "no_key"
          ? t("adt.noKey")
          : err === "not_found"
            ? t("adt.notFound")
            : err === "unparseable" || err === "too_few"
              ? t("adt.badCsv")
              : t("adt.failed"),
        "error"
      );
    }
  }, [src, handle, csv, addToast, t]);

  const sendRewrites = useCallback(async () => {
    if (!report?.llm?.rewrites.length) return;
    setSendingIdeas(true);
    let count = 0;
    for (const r of report.llm.rewrites) {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: r.improved, notes: `Rewrite of: ${r.original}` }),
      }).catch(() => null);
      if (res?.ok) count++;
    }
    setSendingIdeas(false);
    addToast(t("adt.sentIdeas", { count }));
  }, [report, addToast, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
      </div>
    );
  }

  const gradeColor =
    (report?.grade ?? 0) >= 70
      ? "text-success"
      : (report?.grade ?? 0) >= 45
        ? "text-warning"
        : "text-red-400";

  const postRow = (p: AuditReportUi["top"][number], i: number) => (
    <div key={`${p.title}-${i}`} className="p-3 rounded-lg bg-cyber-dark">
      <p className="text-sm text-foreground line-clamp-2">{p.title}</p>
      <p className="text-xs text-cyber-muted mt-1">
        {p.views.toLocaleString(locale)} {t("sched.views").toLowerCase()} ·{" "}
        {(p.likes + p.comments).toLocaleString(locale)} {t("dash.engagements").toLowerCase()} ·{" "}
        {p.hint}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-cyber-muted">{t("adt.intro")}</p>

      {/* Runner */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 space-y-4">
        <div className="flex rounded-lg border border-cyber-border overflow-hidden w-fit">
          {(
            [
              ["youtube", t("adt.srcYouTube")],
              ["csv", t("adt.srcCsv")],
            ] as const
          ).map(([key, lab]) => (
            <button
              key={key}
              onClick={() => setSrc(key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                src === key
                  ? "bg-neon-purple/15 text-neon-purple"
                  : "text-cyber-muted hover:text-foreground"
              }`}
            >
              {lab}
            </button>
          ))}
        </div>
        {src === "youtube" ? (
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handle.trim() && run()}
            placeholder={t("adt.handlePh")}
            className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
          />
        ) : (
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            placeholder={t("adt.csvPh")}
            className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-xs font-mono text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 resize-y"
          />
        )}
        <button
          onClick={run}
          disabled={running || (src === "youtube" ? !handle.trim() : !csv.trim())}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
          {running ? t("adt.running") : t("adt.run")}
        </button>
      </div>

      {report && (
        <>
          {/* Grade hero */}
          <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 flex flex-wrap items-center gap-6">
            <div className="text-center">
              <p className={`text-5xl font-bold ${gradeColor}`}>{report.grade}</p>
              <p className="text-xs text-cyber-muted mt-1">{t("adt.grade")}</p>
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold text-foreground">{report.label}</p>
              <p className="text-xs text-cyber-muted mt-1">
                {report.posts} {t("adt.posts")} · {report.avgViews.toLocaleString(locale)}{" "}
                {t("adt.avgViews")} · {report.engagementRate}% {t("adt.engagement")}
              </p>
              <p className="text-[11px] text-cyber-muted mt-1">
                {new Date(report.createdAt).toLocaleString(locale)}
              </p>
            </div>
            <div className="w-full sm:w-64 space-y-2">
              {report.sections.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="text-[11px] text-cyber-muted w-24 shrink-0">
                    {t(`adt.sec.${s.key}`)}
                  </span>
                  <div className="flex-1 h-1.5 bg-cyber-border rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        s.score >= 70 ? "bg-success" : s.score >= 45 ? "bg-warning" : "bg-red-400"
                      }`}
                      style={{ width: `${s.score}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-cyber-muted w-8 text-right">{s.score}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Findings */}
          {report.findings.length > 0 && (
            <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
              <h3 className="font-semibold text-foreground mb-3">{t("adt.findings")}</h3>
              <ul className="space-y-2">
                {report.findings.map((f, i) => (
                  <li key={i} className="text-sm text-cyber-muted flex gap-2">
                    <span className="text-neon-purple shrink-0">→</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Winners / weakest */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-cyber-card border border-cyber-border rounded-xl p-5">
              <h3 className="font-semibold text-success mb-3">{t("adt.top")}</h3>
              <div className="space-y-2">{report.top.map(postRow)}</div>
            </div>
            <div className="bg-cyber-card border border-cyber-border rounded-xl p-5">
              <h3 className="font-semibold text-red-400 mb-3">{t("adt.bottom")}</h3>
              <div className="space-y-2">{report.bottom.map(postRow)}</div>
            </div>
          </div>

          {/* Coach */}
          {report.llm && (
            <div className="bg-cyber-card border border-neon-purple/30 rounded-xl p-6 space-y-5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-neon-purple" />
                <h3 className="font-semibold text-foreground">{t("adt.insights")}</h3>
              </div>
              <ul className="space-y-2">
                {report.llm.insights.map((s, i) => (
                  <li key={i} className="text-sm text-foreground/90 flex gap-2">
                    <span className="text-neon-purple shrink-0">•</span> {s}
                  </li>
                ))}
              </ul>

              {report.llm.rewrites.length > 0 && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="text-sm font-semibold text-foreground">{t("adt.rewrites")}</h4>
                    <button
                      onClick={sendRewrites}
                      disabled={sendingIdeas}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {sendingIdeas ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Lightbulb className="w-3.5 h-3.5" />
                      )}
                      {t("adt.toIdeas")}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {report.llm.rewrites.map((r, i) => (
                      <div key={i} className="p-3 rounded-lg bg-cyber-dark text-sm">
                        <p className="text-cyber-muted line-through decoration-red-400/50">
                          {r.original}
                        </p>
                        <p className="text-foreground mt-1">{r.improved}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.llm.plan.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2">{t("adt.plan")}</h4>
                  <ol className="space-y-1.5">
                    {report.llm.plan.map((s, i) => (
                      <li key={i} className="text-sm text-cyber-muted flex gap-2">
                        <span className="text-neon-purple font-bold shrink-0">{i + 1}.</span> {s}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Business Tab (creator revenue ledger + brand-deal pipeline) ---
interface RevenueRow {
  id: string;
  month: string;
  stream: string;
  amount: number;
  note: string;
  createdAt: string;
}
interface DealRow {
  id: string;
  brand: string;
  contact: string;
  value: number;
  stage: "lead" | "negotiating" | "booked" | "delivered" | "paid";
  platform: string;
  notes: string;
}

const BIZ_STREAMS = ["adsense", "sponsorship", "affiliate", "products", "membership", "other"];
const BIZ_STAGES: DealRow["stage"][] = ["lead", "negotiating", "booked", "delivered", "paid"];

const bizStageColor: Record<string, string> = {
  lead: "text-electric-blue bg-electric-blue/10",
  negotiating: "text-warning bg-warning/10",
  booked: "text-neon-purple bg-neon-purple/10",
  delivered: "text-foreground bg-cyber-dark",
  paid: "text-success bg-success/10",
};

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function BusinessTab() {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [entries, setEntries] = useState<RevenueRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [formMonth, setFormMonth] = useState(thisMonth);
  const [formStream, setFormStream] = useState("sponsorship");
  const [formAmount, setFormAmount] = useState("");
  const [formNote, setFormNote] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [dealBrand, setDealBrand] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [dealPlatform, setDealPlatform] = useState("TikTok");
  const [dealContact, setDealContact] = useState("");
  const [addingDeal, setAddingDeal] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/revenue", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/deals", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([r, d]) => {
        if (!active) return;
        if (r) setEntries(r.entries);
        if (d) setDeals(d.deals);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const addEntry = useCallback(async () => {
    const amount = Number(formAmount);
    if (!amount || amount <= 0) return;
    setAddingEntry(true);
    const res = await fetch("/api/revenue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: formMonth, stream: formStream, amount, note: formNote }),
    });
    setAddingEntry(false);
    if (res.ok) {
      const { entry } = await res.json();
      setEntries((prev) => [entry, ...prev]);
      setFormAmount("");
      setFormNote("");
    }
  }, [formMonth, formStream, formAmount, formNote]);

  const removeEntry = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      addToast(t("biz.entryDeleted"), "info");
      await fetch(`/api/revenue/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [addToast, t]
  );

  const addDeal = useCallback(async () => {
    if (!dealBrand.trim()) return;
    setAddingDeal(true);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: dealBrand.trim(),
        value: Number(dealValue) || 0,
        platform: dealPlatform,
        contact: dealContact.trim(),
      }),
    });
    setAddingDeal(false);
    if (res.ok) {
      const { deal } = await res.json();
      setDeals((prev) => [deal, ...prev]);
      setDealBrand("");
      setDealValue("");
      setDealContact("");
    }
  }, [dealBrand, dealValue, dealPlatform, dealContact]);

  const setStage = useCallback(
    async (id: string, stage: DealRow["stage"]) => {
      const res = await fetch(`/api/deals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (res.ok) {
        const { deal, revenueAdded } = await res.json();
        setDeals((prev) => prev.map((d) => (d.id === id ? deal : d)));
        if (revenueAdded) {
          addToast(t("biz.paidToRevenue"));
          fetch("/api/revenue", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d && setEntries(d.entries))
            .catch(() => {});
        }
      }
    },
    [addToast, t]
  );

  const removeDeal = useCallback(
    async (id: string) => {
      setDeals((prev) => prev.filter((d) => d.id !== id));
      addToast(t("biz.dealDeleted"), "info");
      await fetch(`/api/deals/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [addToast, t]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
      </div>
    );
  }

  const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1))
    .toISOString()
    .slice(0, 7);
  const sum = (rows: RevenueRow[]) => rows.reduce((s, e) => s + e.amount, 0);
  const thisMonthTotal = sum(entries.filter((e) => e.month === thisMonth));
  const lastMonthTotal = sum(entries.filter((e) => e.month === lastMonth));
  const allTimeTotal = sum(entries);
  const byStream = BIZ_STREAMS.map((s) => ({
    stream: s,
    total: sum(entries.filter((e) => e.month === thisMonth && e.stream === s)),
  })).filter((s) => s.total > 0);
  const maxStream = Math.max(1, ...byStream.map((s) => s.total));

  const pipelineValue = sum2(deals.filter((d) => d.stage === "lead" || d.stage === "negotiating"));
  const bookedValue = sum2(deals.filter((d) => d.stage === "booked" || d.stage === "delivered"));
  const paidValue = sum2(deals.filter((d) => d.stage === "paid"));
  function sum2(rows: DealRow[]): number {
    return rows.reduce((s, d) => s + d.value, 0);
  }

  const field =
    "px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50";

  return (
    <div className="space-y-6">
      <p className="text-sm text-cyber-muted">{t("biz.intro")}</p>

      {/* Revenue summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("biz.thisMonth"), value: thisMonthTotal },
          { label: t("biz.lastMonth"), value: lastMonthTotal },
          { label: t("biz.allTime"), value: allTimeTotal },
        ].map((c) => (
          <div key={c.label} className="bg-cyber-card border border-cyber-border rounded-xl p-4">
            <p className="text-2xl font-bold text-foreground">{money(c.value)}</p>
            <p className="text-xs text-cyber-muted mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Revenue ledger */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-neon-purple" />
            <h2 className="font-semibold text-foreground">{t("biz.revenue")}</h2>
          </div>
          {entries.length > 0 && (
            <button
              onClick={() => {
                const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
                const csv = [
                  "month,stream,amount,note",
                  ...entries.map((e) =>
                    [e.month, e.stream, String(e.amount), e.note].map(esc).join(",")
                  ),
                ].join("\n");
                downloadBlob("virafold-revenue.csv", "text/csv", csv);
              }}
              className="text-xs text-neon-purple hover:underline flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> {t("aud.exportCsv")}
            </button>
          )}
        </div>
        <div className="p-6 space-y-4">
          {byStream.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-cyber-muted">{t("biz.byStream")}</p>
              {byStream.map((s) => (
                <div key={s.stream} className="flex items-center gap-3">
                  <span className="text-xs text-foreground w-28 shrink-0">
                    {t(`biz.stream.${s.stream}`)}
                  </span>
                  <div className="flex-1 h-2 bg-cyber-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-neon-purple to-electric-blue rounded-full"
                      style={{ width: `${(s.total / maxStream) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-cyber-muted w-20 text-right">{money(s.total)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              type="month"
              value={formMonth}
              onChange={(e) => setFormMonth(e.target.value)}
              className={field}
            />
            <select
              value={formStream}
              onChange={(e) => setFormStream(e.target.value)}
              className={field}
            >
              {BIZ_STREAMS.map((s) => (
                <option key={s} value={s}>
                  {t(`biz.stream.${s}`)}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <span className="text-sm text-cyber-muted">$</span>
              <input
                type="number"
                min={0}
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0"
                className={`${field} w-28`}
              />
            </div>
            <input
              type="text"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder={t("biz.notePh")}
              maxLength={200}
              className={`${field} flex-1 min-w-[140px]`}
            />
            <button
              onClick={addEntry}
              disabled={addingEntry || !Number(formAmount)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {addingEntry ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t("biz.add")}
            </button>
          </div>
          {entries.length === 0 ? (
            <p className="text-sm text-cyber-muted text-center py-4">{t("biz.noRevenue")}</p>
          ) : (
            <div className="divide-y divide-cyber-border max-h-64 overflow-y-auto">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className="text-xs text-cyber-muted w-16 shrink-0">{e.month}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-cyber-dark text-cyber-muted shrink-0">
                    {t(`biz.stream.${e.stream}`)}
                  </span>
                  <span className="text-sm text-foreground flex-1 truncate">{e.note}</span>
                  <span className="text-sm font-medium text-foreground shrink-0">
                    {money(e.amount)}
                  </span>
                  <button
                    onClick={() => removeEntry(e.id)}
                    className="p-1 text-cyber-muted hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Brand deals */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b border-cyber-border">
          <h2 className="font-semibold text-foreground">{t("biz.deals")}</h2>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-electric-blue">
              {t("biz.pipelineValue")}: {money(pipelineValue)}
            </span>
            <span className="text-neon-purple">
              {t("biz.bookedValue")}: {money(bookedValue)}
            </span>
            <span className="text-success">
              {t("biz.paidValue")}: {money(paidValue)}
            </span>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={dealBrand}
              onChange={(e) => setDealBrand(e.target.value)}
              placeholder={t("biz.brandPh")}
              maxLength={100}
              className={`${field} flex-1 min-w-[140px]`}
            />
            <div className="flex items-center gap-1">
              <span className="text-sm text-cyber-muted">$</span>
              <input
                type="number"
                min={0}
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
                placeholder="0"
                className={`${field} w-28`}
              />
            </div>
            <select
              value={dealPlatform}
              onChange={(e) => setDealPlatform(e.target.value)}
              className={field}
            >
              {SCHED_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={dealContact}
              onChange={(e) => setDealContact(e.target.value)}
              placeholder={t("biz.contactPh")}
              maxLength={200}
              className={`${field} flex-1 min-w-[140px]`}
            />
            <button
              onClick={addDeal}
              disabled={addingDeal || !dealBrand.trim()}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {addingDeal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t("biz.addDeal")}
            </button>
          </div>
          {deals.length === 0 ? (
            <p className="text-sm text-cyber-muted text-center py-4">{t("biz.noDeals")}</p>
          ) : (
            <div className="space-y-2">
              {deals.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-cyber-dark border border-cyber-border"
                >
                  <div className="flex-1 min-w-[140px]">
                    <p className="text-sm font-medium text-foreground truncate">{d.brand}</p>
                    <p className="text-xs text-cyber-muted truncate">
                      {d.platform}
                      {d.contact ? ` · ${d.contact}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-foreground shrink-0">
                    {money(d.value)}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${bizStageColor[d.stage]}`}
                  >
                    {t(`biz.stage.${d.stage}`)}
                  </span>
                  <select
                    value={d.stage}
                    onChange={(e) => setStage(d.id, e.target.value as DealRow["stage"])}
                    className="px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50 shrink-0"
                  >
                    {BIZ_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {t(`biz.stage.${s}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeDeal(d.id)}
                    className="p-1 text-cyber-muted hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Analytics Tab (real aggregates from this workspace's own data) ---
interface AnalyticsData {
  totals: {
    assets: number;
    liveAssets: number;
    projects: number;
    publishedProjects: number;
    scheduled: number;
    published: number;
    likes: number;
  };
  platforms: { platform: string; scheduled: number; published: number }[];
  types: { type: string; count: number }[];
  recentPublished: { assetName: string; platform: string; scheduledAt: string }[];
  measured: { posts: number; views: number; likes: number; comments: number };
  topPerformers: {
    assetId: string;
    assetName: string;
    platform: string;
    views: number;
    likes: number;
    comments: number;
  }[];
}

function AnalyticsTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/analytics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d && setData(d))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 rounded-full border-2 border-cyber-border border-t-neon-purple animate-spin" />
      </div>
    );
  }

  if (!data || data.totals.assets === 0) {
    return (
      <div className="text-center py-24 text-cyber-muted max-w-md mx-auto">
        <BarChart3 className="w-10 h-10 mx-auto mb-4 opacity-50" />
        {t("dash.noAnalytics")}
      </div>
    );
  }

  const metrics = [
    { label: t("dash.totalAssets"), value: data.totals.assets, icon: Film, color: "text-neon-purple" },
    { label: t("dash.publishedPosts"), value: data.totals.published, icon: CheckCircle, color: "text-success" },
    { label: t("dash.scheduledPosts"), value: data.totals.scheduled, icon: Clock, color: "text-warning" },
    { label: t("dash.likedAssets"), value: data.totals.likes, icon: ThumbsUp, color: "text-electric-blue" },
  ];
  const maxPlatform = Math.max(1, ...data.platforms.map((p) => p.scheduled + p.published));
  const maxType = Math.max(1, ...data.types.map((ty) => ty.count));

  return (
    <div className="space-y-6">
      <p className="text-sm text-cyber-muted">{t("dash.analyticsLive")}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="bg-cyber-card border border-cyber-border rounded-xl p-4">
            <m.icon className={`w-5 h-5 ${m.color} mb-2`} />
            <p className="text-2xl font-bold text-foreground">{m.value}</p>
            <p className="text-xs text-cyber-muted mt-1">{m.label}</p>
          </div>
        ))}
      </div>

      {data.platforms.length > 0 && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">{t("dash.platformPerformance")}</h3>
          <div className="space-y-4">
            {data.platforms.map((p) => (
              <div key={p.platform} className="flex items-center gap-4">
                <span className="text-sm text-foreground w-24 shrink-0">{p.platform}</span>
                <div className="flex-1 h-2 bg-cyber-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-neon-purple to-electric-blue rounded-full"
                    style={{ width: `${((p.scheduled + p.published) / maxPlatform) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-success w-24 text-right">
                  {p.published} {t("dash.published").toLowerCase()}
                </span>
                <span className="text-xs text-warning w-24 text-right">
                  {p.scheduled} {t("dash.scheduledLower")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
        <h3 className="font-semibold text-foreground mb-4">{t("dash.assetMix")}</h3>
        <div className="space-y-3">
          {data.types.map((ty) => (
            <div key={ty.type} className="flex items-center gap-4">
              <span className="text-sm text-foreground w-40 shrink-0 truncate">{ty.type}</span>
              <div className="flex-1 h-2 bg-cyber-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-electric-blue to-cyan-500 rounded-full"
                  style={{ width: `${(ty.count / maxType) * 100}%` }}
                />
              </div>
              <span className="text-xs text-cyber-muted w-8 text-right">{ty.count}</span>
            </div>
          ))}
        </div>
      </div>

      {data.measured.posts > 0 && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="font-semibold text-foreground">{t("dash.topPerformers")}</h3>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-neon-purple">
                {t("dash.measuredViews")}: {data.measured.views.toLocaleString()}
              </span>
              <span className="text-electric-blue">
                {t("dash.engagements")}:{" "}
                {(data.measured.likes + data.measured.comments).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="space-y-3">
            {data.topPerformers.map((p, i) => (
              <div key={`${p.assetId}-${i}`} className="flex items-center gap-4 p-3 rounded-lg bg-cyber-dark">
                <span className="text-lg font-bold text-neon-purple w-8">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.assetName}</p>
                  <p className="text-xs text-cyber-muted">{p.platform}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-foreground">
                    {p.views.toLocaleString()}
                    <span className="text-xs text-cyber-muted"> {t("sched.views").toLowerCase()}</span>
                  </p>
                  <p className="text-xs text-cyber-muted">
                    {(p.likes + p.comments).toLocaleString()} {t("dash.engagements").toLowerCase()}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-cyber-muted mt-4">{t("dash.flywheelHint")}</p>
        </div>
      )}

      {data.recentPublished.length > 0 && (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">{t("dash.recentPublishes")}</h3>
          <div className="space-y-3">
            {data.recentPublished.map((r, i) => (
              <div key={`${r.assetName}-${i}`} className="flex items-center gap-4 p-3 rounded-lg bg-cyber-dark">
                <Send className="w-4 h-4 text-neon-purple shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{r.assetName}</p>
                  <p className="text-xs text-cyber-muted">{r.platform}</p>
                </div>
                <span className="text-xs text-cyber-muted shrink-0">
                  {new Date(r.scheduledAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Notifications Tab ---
// Server notification titles → the tab where that event actually lives, so a
// "Clip Ready" notification is one click from the clip itself.
const NOTIF_TABS: Record<string, Tab> = {
  "Clip Ready": "Clips",
  "Clip Render Failed": "Clips",
  "Scheduled Post Published": "Schedule",
  "Evergreen Re-queued": "Schedule",
  "A/B Hook Test Decided": "Schedule",
  "Assets Ready for Review": "Projects",
  "Media Transcribed": "Projects",
  "Your Weekly Brief": "Analytics",
};

function NotificationsTab({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
}: {
  notifications: { id: string; title: string; message: string; time: string; read: boolean; type: string }[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onNavigate: (tab: Tab) => void;
}) {
  const { t } = useTranslation();
  const typeIcons: Record<string, typeof CheckCircle> = { success: CheckCircle, info: Bell, warning: Clock };
  const typeColors: Record<string, string> = { success: "text-success", info: "text-electric-blue", warning: "text-warning" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-cyber-muted">
          {t("dash.unread", { count: notifications.filter((n) => !n.read).length })}
        </p>
        <button onClick={onMarkAllRead} className="text-xs text-neon-purple hover:underline">
          {t("dash.markAllRead")}
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16 text-cyber-muted">{t("dash.noNotifications")}</div>
      ) : (
        notifications.map((n) => {
          const Icon = typeIcons[n.type] || Bell;
          const color = typeColors[n.type] || "text-cyber-muted";
          return (
            <div
              key={n.id}
              onClick={() => onMarkRead(n.id)}
              className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-colors ${
                n.read
                  ? "bg-cyber-card border-cyber-border opacity-60"
                  : "bg-cyber-card border-neon-purple/20 hover:border-neon-purple/40"
              }`}
            >
              <Icon className={`w-5 h-5 mt-0.5 ${color}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  {!n.read && <div className="w-2 h-2 rounded-full bg-neon-purple" />}
                </div>
                <p className="text-sm text-cyber-muted mt-0.5">{n.message}</p>
                <p className="text-xs text-cyber-muted mt-1">{n.time}</p>
              </div>
              {NOTIF_TABS[n.title] && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead(n.id);
                    onNavigate(NOTIF_TABS[n.title]);
                  }}
                  className="text-xs text-electric-blue hover:underline shrink-0 flex items-center gap-0.5"
                >
                  {t("notif.open")} <ChevronRight className="w-3 h-3" />
                </button>
              )}
              {!n.read && (
                <button className="text-xs text-neon-purple hover:underline shrink-0">
                  {t("dash.markRead")}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// --- Settings Tab ---
function SettingsTab({
  user,
  form,
  setForm,
  saved,
  onSave,
}: {
  user: { name: string; email: string };
  form: { name: string; email: string; notifications: boolean; autoPublish: boolean };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; email: string; notifications: boolean; autoPublish: boolean }>>;
  saved: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
        <h3 className="font-semibold text-foreground mb-4">{t("dash.profile")}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-cyber-muted mb-1.5">{t("dash.displayName")}</label>
            <input
              type="text"
              value={form.name || user.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
            />
          </div>
          <div>
            <label className="block text-sm text-cyber-muted mb-1.5">{t("auth.email")}</label>
            <input
              type="email"
              value={form.email || user.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-4 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
            />
          </div>
        </div>
      </div>

      <div className="bg-cyber-card border border-cyber-border rounded-xl p-6">
        <h3 className="font-semibold text-foreground mb-4">{t("dash.preferences")}</h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm text-foreground">{t("dash.emailNotifications")}</p>
              <p className="text-xs text-cyber-muted">{t("dash.emailNotificationsDesc")}</p>
            </div>
            <button
              onClick={() => setForm({ ...form, notifications: !form.notifications })}
              className={`w-11 h-6 rounded-full transition-colors relative ${form.notifications ? "bg-neon-purple" : "bg-cyber-border"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${form.notifications ? "translate-x-5.5 left-0.5" : "left-0.5"}`} style={{ transform: form.notifications ? "translateX(22px)" : "translateX(0)" }} />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm text-foreground">{t("dash.autoPublish")}</p>
              <p className="text-xs text-cyber-muted">{t("dash.autoPublishDesc")}</p>
            </div>
            <button
              onClick={() => setForm({ ...form, autoPublish: !form.autoPublish })}
              className={`w-11 h-6 rounded-full transition-colors relative ${form.autoPublish ? "bg-neon-purple" : "bg-cyber-border"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform`} style={{ transform: form.autoPublish ? "translateX(22px)" : "translateX(0)", left: "2px" }} />
            </button>
          </label>
        </div>
      </div>

      <BrandVoicePanel />

      <ConnectedAccountsCard />

      <ManagedClientsCard />

      <ExportCard />

      <IntegrationsPanel />

      <button
        onClick={onSave}
        className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm hover:opacity-90 transition-opacity flex items-center gap-2"
      >
        {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saved ? t("dash.saved") : t("dash.saveSettings")}
      </button>

      <DangerZoneCard />
    </div>
  );
}

/** Amber strip shown until the account's email is confirmed. Soft gate: the
 *  product keeps working, this only nudges. */
function VerifyEmailBanner() {
  const { user, addToast } = useApp();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!user || user.emailVerified !== false) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <p className="flex-1 min-w-[220px] text-sm text-amber-200/90">
        {t("verify.body", { email: user.email })}
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch("/api/auth/verify/resend", { method: "POST" });
            const data = await res.json().catch(() => null);
            addToast(
              res.ok ? t("verify.sent") : String(data?.error ?? "Could not send the email"),
              res.ok ? "success" : "error"
            );
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
      >
        {t("verify.resend")}
      </button>
    </div>
  );
}

/** Type-to-confirm full account deletion — the GDPR counterpart to export. */
function DangerZoneCard() {
  const { user } = useApp();
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const match = confirm.trim().toLowerCase() === user.email.toLowerCase();
  return (
    <div className="bg-cyber-card border border-red-500/25 rounded-xl p-6">
      <h3 className="font-semibold text-red-400 mb-1">{t("danger.title")}</h3>
      <p className="text-xs text-cyber-muted mb-4">{t("danger.desc")}</p>
      <label className="block text-sm text-cyber-muted mb-1.5" htmlFor="danger-confirm">
        {t("danger.confirmLabel")}
      </label>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          id="danger-confirm"
          type="email"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={user.email}
          className="flex-1 px-4 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-red-500/50"
        />
        <button
          disabled={!match || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch("/api/account", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm }),
              });
              if (res.ok) {
                window.location.href = "/";
                return;
              }
              const data = await res.json().catch(() => null);
              setError(String(data?.error ?? "Deletion failed — try again"));
            } finally {
              setBusy(false);
            }
          }}
          className="px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm font-medium hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "…" : t("danger.delete")}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

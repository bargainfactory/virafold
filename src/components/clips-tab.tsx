"use client";

/**
 * Clip Studio: audit-informed highlight detection + rendered vertical clips.
 * Suggestions are picked to match the creator's own proven winners (post
 * metrics + audit history), then rendered server-side with burned captions
 * and scheduled straight to YouTube/TikTok.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import {
  useConnections,
  isConnected,
  nextMorning,
  lastPlatform,
  rememberPlatform,
} from "@/lib/use-connections";
import {
  Calendar,
  Check,
  ChevronDown,
  Download,
  Film,
  FileVideo,
  Loader2,
  Moon,
  Play,
  Scissors,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";

/** Date → the local value a datetime-local input expects. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Schedule-time picker with a visible "this is editable" chevron. The native
 *  calendar indicator is stretched invisibly across the whole field, so
 *  clicking anywhere opens the picker; the chevron is the affordance. */
function SchedTimeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-3 pr-8 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground cursor-pointer focus:outline-none focus:border-neon-purple/50 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
      <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-neon-purple pointer-events-none" />
    </div>
  );
}

interface ClipRow {
  id: string;
  projectId: string;
  title: string;
  startSec: number;
  endSec: number;
  tight?: number;
  score: number;
  reason: string;
  matched: string | null;
  status: "suggested" | "queued" | "rendering" | "ready" | "failed";
  style: string;
  position: string;
  focus: string;
  kind: string;
  outputPath: string | null;
  error: string | null;
}

const CLIP_POSITIONS = [
  { key: "top", label: "Top" },
  { key: "middle", label: "Middle" },
  { key: "bottom", label: "Bottom" },
];

const CLIP_FOCUSES = [
  { key: "left", label: "Left" },
  { key: "center", label: "Center" },
  { key: "right", label: "Right" },
];

// Caption overlay placement per position (bottom varies by style density).
function capPosClass(position: string, style: string): string {
  if (position === "top") return "top-[8%]";
  if (position === "middle") return "top-1/2 -translate-y-1/2";
  return style === "clean" ? "bottom-[12%]" : "bottom-[30%]";
}

const CLIP_STYLES = [
  { key: "bold", label: "Bold" },
  { key: "neon", label: "Neon" },
  { key: "clean", label: "Clean" },
];

interface PreviewWord {
  w: string;
  s: number;
  e: number;
  sp?: number;
}

interface CaptionChunk {
  s: number;
  e: number;
  text: string;
}

// Mirrors the server-side ASS chunking (render.ts) so the browser preview
// shows the same caption grouping the final render will burn in.
const CAP_STYLE: Record<string, { cls: string; up: boolean; n: number }> = {
  bold: {
    cls: "text-white font-black text-2xl uppercase leading-tight [text-shadow:-2px_-2px_0_#000,2px_-2px_0_#000,-2px_2px_0_#000,2px_2px_0_#000,0_3px_8px_rgba(0,0,0,0.6)]",
    up: true,
    n: 3,
  },
  neon: {
    cls: "text-white font-bold text-2xl leading-tight [text-shadow:0_0_12px_#a855f7,0_0_26px_#a855f7,1px_1px_2px_#000]",
    up: false,
    n: 3,
  },
  clean: {
    cls: "text-white text-base font-medium [text-shadow:1px_1px_3px_#000,-1px_-1px_3px_#000]",
    up: false,
    n: 4,
  },
};

function chunkWords(words: PreviewWord[], clip: ClipRow, style: string): CaptionChunk[] {
  const cfg = CAP_STYLE[style] ?? CAP_STYLE.bold;
  const inRange = words.filter((w) => w.e > clip.startSec && w.s < clip.endSec);
  const chunks: CaptionChunk[] = [];
  let cur: PreviewWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    let text = cur.map((w) => w.w).join(" ");
    if (cfg.up) text = text.toUpperCase();
    chunks.push({ s: cur[0].s, e: cur[cur.length - 1].e, text });
    cur = [];
  };
  for (const w of inRange) {
    // Speaker turns (diarized interviews) always start a fresh caption —
    // same rule as the server renderer.
    if (cur.length && w.sp !== undefined && w.sp !== cur[cur.length - 1].sp) flush();
    cur.push(w);
    if (cur.length >= cfg.n || cur[cur.length - 1].e - cur[0].s >= 2.2) flush();
  }
  flush();
  return chunks;
}

/** Instant clip preview, rendered entirely in the browser: the real source
 *  video center-cropped to 9:16 with live caption overlay — no server render
 *  spent until the creator likes what they see. */
/** Client replica of the server's tight-cut segmenting (render.ts) so the
 *  preview plays the same cuts the final render will make. Constants must
 *  match the server's TIGHT_GAP / TIGHT_PAD. */
function previewTightSegments(
  words: PreviewWord[],
  start: number,
  end: number
): { a: number; b: number }[] | null {
  const GAP = 0.5;
  const PAD = 0.12;
  const inWin = words.filter((w) => w.e > start && w.s < end).sort((x, y) => x.s - y.s);
  if (inWin.length < 3) return null;
  const runs: { a: number; b: number }[] = [];
  let cur = { a: inWin[0].s, b: inWin[0].e };
  for (let i = 1; i < inWin.length; i++) {
    const w = inWin[i];
    if (w.s - cur.b > GAP) {
      runs.push(cur);
      cur = { a: w.s, b: w.e };
    } else cur.b = Math.max(cur.b, w.e);
  }
  runs.push(cur);
  const merged: { a: number; b: number }[] = [];
  for (const r of runs.map((x) => ({ a: Math.max(start, x.a - PAD), b: Math.min(end, x.b + PAD) }))) {
    const last = merged[merged.length - 1];
    if (last && r.a <= last.b + 0.01) last.b = Math.max(last.b, r.b);
    else merged.push({ ...r });
  }
  const removed = end - start - merged.reduce((s, r) => s + (r.b - r.a), 0);
  return removed < 0.25 ? null : merged;
}

function ClipPreviewModal({
  clip,
  words,
  style,
  position,
  focus,
  tight,
  onStyleChange,
  onPositionChange,
  onFocusChange,
  onRender,
  onClose,
}: {
  clip: ClipRow;
  tight: boolean;
  words: PreviewWord[];
  style: string;
  position: string;
  focus: string;
  onStyleChange: (s: string) => void;
  onPositionChange: (p: string) => void;
  onFocusChange: (f: string) => void;
  onRender: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [caption, setCaption] = useState("");
  const chunks = useMemo(() => chunkWords(words, clip, style), [words, clip, style]);
  const cfg = CAP_STYLE[style] ?? CAP_STYLE.bold;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seekAndPlay = () => {
      v.currentTime = clip.startSec;
      v.play().catch(() => {
        /* autoplay may need a tap on mobile — controls are visible */
      });
    };
    if (v.readyState >= 1) seekAndPlay();
    v.addEventListener("loadedmetadata", seekAndPlay);
    // Preview parity: when tight cut is on, skip playback over the same
    // gaps the render will remove — captions stay keyed to source time, so
    // they remain in sync through the jumps.
    const segs = tight ? previewTightSegments(words, clip.startSec, clip.endSec) : null;
    let raf = 0;
    const tick = () => {
      // Loop the clip window and keep the caption in sync with playback.
      if (v.currentTime >= clip.endSec) v.currentTime = clip.startSec;
      if (segs) {
        const now0 = v.currentTime;
        const inSeg = segs.some((s) => now0 >= s.a && now0 <= s.b);
        if (!inSeg) {
          const next = segs.find((s) => s.a > now0);
          v.currentTime = next ? next.a : segs[0].a;
        }
      }
      const now = v.currentTime;
      setCaption(chunks.find((c) => now >= c.s && now <= c.e)?.text ?? "");
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      v.removeEventListener("loadedmetadata", seekAndPlay);
      cancelAnimationFrame(raf);
      v.pause();
    };
  }, [clip, chunks, tight, words]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-cyber-card border border-cyber-border rounded-2xl p-4 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground line-clamp-1">{clip.title}</p>
            <p className="text-[11px] text-cyber-muted mt-0.5">{t("clips.previewNote")}</p>
          </div>
          <button
            onClick={onClose}
            className="text-cyber-muted hover:text-foreground transition-colors shrink-0"
            title={t("clips.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative mx-auto aspect-[9/16] max-h-[60vh] rounded-xl overflow-hidden bg-black">
          <video
            ref={videoRef}
            src={`/api/projects/${clip.projectId}/media`}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: `${focus} center` }}
            playsInline
            muted={false}
            controls={false}
          />
          {caption && (
            <div className={`absolute inset-x-3 text-center ${capPosClass(position, style)}`}>
              <span className={cfg.cls}>{caption}</span>
            </div>
          )}
          {!words.length && (
            <p className="absolute bottom-3 inset-x-3 text-center text-[11px] text-white/70">
              {t("clips.previewNoWords")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <select
            value={style}
            onChange={(e) => onStyleChange(e.target.value)}
            className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            {CLIP_STYLES.map((s) => (
              <option key={s.key} value={s.key}>
                {t("clips.captions")}: {s.label}
              </option>
            ))}
          </select>
          <select
            value={position}
            onChange={(e) => onPositionChange(e.target.value)}
            className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            {CLIP_POSITIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {t("clips.position")}: {p.label}
              </option>
            ))}
          </select>
          <select
            value={focus}
            onChange={(e) => onFocusChange(e.target.value)}
            className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            {CLIP_FOCUSES.map((f) => (
              <option key={f.key} value={f.key}>
                {t("clips.focus")}: {f.label}
              </option>
            ))}
          </select>
          <button
            onClick={onRender}
            className="flex-1 min-w-[140px] px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
          >
            <Film className="w-3.5 h-3.5" /> {t("clips.previewRender")}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtClipTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-success border-success/40 bg-success/10";
  if (score >= 45) return "text-warning border-warning/40 bg-warning/10";
  return "text-cyber-muted border-cyber-border bg-cyber-dark";
}

export default function ClipsTab({
  initialProject = "",
  onNavigate,
  onUpload,
}: {
  /** Preselects a project when arriving from the Projects tab's clip button. */
  initialProject?: string;
  /** Navigates to Settings for the connect-account nudge. */
  onNavigate?: () => void;
  /** Opens the upload modal — the empty state's primary CTA. */
  onUpload?: () => void;
}) {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const connections = useConnections();
  const defaultAt = useMemo(() => nextMorning(), []);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [selProject, setSelProject] = useState(initialProject);
  const [detecting, setDetecting] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);
  const [styleSel, setStyleSel] = useState<Record<string, string>>({});
  const [posSel, setPosSel] = useState<Record<string, string>>({});
  const [focusSel, setFocusSel] = useState<Record<string, string>>({});
  const [schedAt, setSchedAt] = useState<Record<string, string>>({});
  const [schedPlatform, setSchedPlatform] = useState<Record<string, string>>({});
  // clipId → its live scheduled post, so the card edits the time in place
  // instead of stacking duplicate posts.
  const [schedPosts, setSchedPosts] = useState<
    Record<string, { id: string; scheduledAt: string; platform: string }>
  >({});
  const [preview, setPreview] = useState<{ clip: ClipRow; words: PreviewWord[] } | null>(null);
  const [tightSel, setTightSel] = useState<Record<string, boolean>>({});
  const [ambTheme, setAmbTheme] = useState("");
  const [ambMinutes, setAmbMinutes] = useState(30);
  const [ambScape, setAmbScape] = useState("ocean");
  const [ambBusy, setAmbBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/clips", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setProjects(d.projects ?? []);
        setClips(d.clips ?? []);
        setSelProject((cur) => cur || d.projects?.[0]?.id || "");
      })
      .catch(() => {});
    // Existing scheduled posts, so a scheduled clip's time stays editable here.
    fetch("/api/schedule", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.posts) return;
        const map: Record<string, { id: string; scheduledAt: string; platform: string }> = {};
        for (const p of d.posts as {
          id: string;
          clipId?: string | null;
          status: string;
          scheduledAt: string;
          platform: string;
        }[]) {
          if (p.clipId && p.status === "scheduled") {
            map[p.clipId] = { id: p.id, scheduledAt: p.scheduledAt, platform: p.platform };
          }
        }
        setSchedPosts(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createAmbient = useCallback(async () => {
    if (ambBusy || ambTheme.trim().length < 3) return;
    setAmbBusy(true);
    try {
      const res = await fetch("/api/ambient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: ambTheme.trim(), minutes: ambMinutes, soundscape: ambScape }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setAmbTheme("");
        addToast(t("amb.queued"));
        load();
      } else {
        addToast(d?.error ?? t("clips.renderFailed"), "error");
      }
    } finally {
      setAmbBusy(false);
    }
  }, [ambBusy, ambTheme, ambMinutes, ambScape, addToast, t, load]);

  // Poll while anything is in the render queue so status flips live.
  const hasActive = clips.some((c) => c.status === "queued" || c.status === "rendering");
  useEffect(() => {
    if (!hasActive) return;
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [hasActive, load]);

  const detect = useCallback(async () => {
    if (!selProject || detecting) return;
    setDetecting(true);
    setEngine(null);
    try {
      const res = await fetch(`/api/projects/${selProject}/highlights`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setEngine(data?.engine ?? null);
        addToast(t("clips.found").replace("{n}", String(data?.clips?.length ?? 0)));
        load();
      } else {
        addToast(data?.error || t("clips.detectFailed"), "error");
      }
    } catch {
      addToast(t("clips.detectFailed"), "error");
    } finally {
      setDetecting(false);
    }
  }, [selProject, detecting, addToast, t, load]);

  const render = useCallback(
    async (clip: ClipRow) => {
      const style = styleSel[clip.id] ?? "bold";
      const position = posSel[clip.id] ?? clip.position ?? "bottom";
      const focus = focusSel[clip.id] ?? clip.focus ?? "center";
      const tight = tightSel[clip.id] ?? clip.tight !== 0;
      const res = await fetch(`/api/clips/${clip.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style, position, focus, tight }),
      });
      if (res.ok) {
        addToast(t("clips.queued"));
        load();
      } else {
        const data = await res.json().catch(() => null);
        addToast(data?.error || t("clips.renderFailed"), "error");
      }
    },
    [styleSel, posSel, focusSel, tightSel, addToast, t, load]
  );

  /** True when the picker/platform differ from the saved scheduled post —
   *  the button then becomes an emphasized "Apply new time". */
  const hasPendingChange = useCallback(
    (clipId: string): boolean => {
      const post = schedPosts[clipId];
      if (!post) return false;
      const at = schedAt[clipId];
      const platform = schedPlatform[clipId];
      const timeChanged =
        at !== undefined && at !== toLocalInput(new Date(post.scheduledAt));
      const platformChanged = platform !== undefined && platform !== post.platform;
      return timeChanged || platformChanged;
    },
    [schedPosts, schedAt, schedPlatform]
  );

  const schedule = useCallback(
    async (clip: ClipRow) => {
      const existing = schedPosts[clip.id];
      const at =
        schedAt[clip.id] ??
        (existing ? toLocalInput(new Date(existing.scheduledAt)) : defaultAt);
      if (!at) return;
      const platform =
        clip.kind === "ambient"
          ? "YouTube" // long-form: Shorts/TikTok duration caps rule them out
          : schedPlatform[clip.id] ?? existing?.platform ?? lastPlatform("YouTube");

      // An already-scheduled clip edits its post in place — no duplicates.
      if (existing) {
        const res = await fetch(`/api/schedule/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, scheduledAt: at }),
        });
        if (res.ok) {
          setSchedPosts((prev) => ({
            ...prev,
            [clip.id]: { ...existing, scheduledAt: at, platform },
          }));
          addToast(t("clips.timeUpdated"));
        } else {
          const data = await res.json().catch(() => null);
          addToast(data?.error || t("clips.scheduleFailed"), "error");
        }
        return;
      }

      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: clip.id,
          assetName: clip.title,
          platform,
          scheduledAt: at,
        }),
      });
      if (res.ok) {
        rememberPlatform(platform);
        const data = await res.json().catch(() => null);
        if (data?.post?.id) {
          setSchedPosts((prev) => ({
            ...prev,
            [clip.id]: { id: data.post.id, scheduledAt: at, platform },
          }));
        }
        addToast(t("clips.scheduled").replace("{p}", platform));
      } else {
        const data = await res.json().catch(() => null);
        addToast(data?.error || t("clips.scheduleFailed"), "error");
      }
    },
    [schedAt, schedPlatform, schedPosts, defaultAt, addToast, t]
  );

  const remove = useCallback(async (clip: ClipRow) => {
    await fetch(`/api/clips/${clip.id}`, { method: "DELETE" }).catch(() => {});
    setClips((prev) => prev.filter((c) => c.id !== clip.id));
  }, []);

  const openPreview = useCallback(
    async (clip: ClipRow) => {
      try {
        const res = await fetch(`/api/clips/${clip.id}`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.clip) {
          setPreview({ clip: data.clip, words: data.words ?? [] });
        } else {
          addToast(t("clips.previewFailed"), "error");
        }
      } catch {
        addToast(t("clips.previewFailed"), "error");
      }
    },
    [addToast, t]
  );

  const projClips = clips.filter(
    (c) => c.kind !== "script" && c.kind !== "ambient" && (!selProject || c.projectId === selProject)
  );
  const svClips = clips.filter((c) => c.kind === "script" || c.kind === "caption");
  const ambClips = clips.filter((c) => c.kind === "ambient");

  // Caption-only render of the selected project's full source video.
  const [captioning, setCaptioning] = useState(false);
  const captionFull = useCallback(async () => {
    if (!selProject || captioning) return;
    setCaptioning(true);
    try {
      const res = await fetch(`/api/projects/${selProject}/caption`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        addToast(t("clips.captionQueued"));
        load();
      } else {
        addToast(d?.error ?? t("clips.renderFailed"), "error");
      }
    } finally {
      setCaptioning(false);
    }
  }, [selProject, captioning, addToast, t, load]);

  // AI thumbnails for ready videos: background art + title overlay.
  const [thumbs, setThumbs] = useState<Record<string, { id?: string; busy: boolean }>>({});
  const genThumb = useCallback(
    async (clip: ClipRow) => {
      setThumbs((p) => ({ ...p, [clip.id]: { busy: true } }));
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: clip.title, topic: clip.reason || clip.title }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.id) {
        setThumbs((p) => ({ ...p, [clip.id]: { id: d.id, busy: false } }));
      } else {
        setThumbs((p) => ({ ...p, [clip.id]: { busy: false } }));
        addToast(d?.error ?? t("clips.thumbFailed"), "error");
      }
    },
    [addToast, t]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Scissors className="w-5 h-5 text-neon-purple" /> {t("clips.title")}
        </h2>
        <p className="text-sm text-cyber-muted mt-1">{t("clips.sub")}</p>
        <p className="text-[11px] text-warning mt-1.5">{t("clips.retentionNote")}</p>
      </div>

      {projects.length === 0 ? (
        /* Empty state as a pitch: show what comes out, explain the three
           steps, and put the upload CTA right here instead of a dead end. */
        <div className="rounded-2xl bg-gradient-to-r from-neon-purple via-fuchsia-500 to-electric-blue p-[1.5px] shadow-[0_0_45px_rgba(168,85,247,0.18)]">
          <div className="bg-cyber-card rounded-2xl p-6 sm:p-10">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-3">
                  {t("clips.emptyTitle")}
                </h3>
                <p className="text-sm text-cyber-muted leading-relaxed mb-6">
                  {t("clips.emptySub")}
                </p>

                <div className="space-y-4 mb-8">
                  {[
                    { icon: FileVideo, tKey: "clips.emptyS1t", dKey: "clips.emptyS1d" },
                    { icon: Sparkles, tKey: "clips.emptyS2t", dKey: "clips.emptyS2d" },
                    { icon: Film, tKey: "clips.emptyS3t", dKey: "clips.emptyS3d" },
                  ].map((s, i) => (
                    <div key={s.tKey} className="flex gap-3">
                      <span className="w-8 h-8 rounded-lg bg-neon-purple/15 border border-neon-purple/30 flex items-center justify-center shrink-0">
                        <s.icon className="w-4 h-4 text-neon-purple" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {i + 1}. {t(s.tKey)}
                        </p>
                        <p className="text-xs text-cyber-muted mt-0.5 leading-relaxed">
                          {t(s.dKey)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => onUpload?.()}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 via-neon-purple to-electric-blue text-white font-semibold text-sm shadow-lg shadow-neon-purple/40 hover:brightness-110 transition-all flex items-center gap-2"
                >
                  <FileVideo className="w-4 h-4" /> {t("clips.emptyCta")}
                </button>
                <p className="text-[11px] text-cyber-muted mt-2">{t("clips.emptyHint")}</p>
              </div>

              {/* What comes out: three scored 9:16 clip mockups */}
              <div className="hidden sm:flex items-end justify-center gap-4 select-none" aria-hidden="true">
                {[
                  { score: 87, h: "h-48", glow: false },
                  { score: 94, h: "h-60", glow: true },
                  { score: 81, h: "h-44", glow: false },
                ].map((m, i) => (
                  <div
                    key={i}
                    className={`relative w-28 ${m.h} rounded-2xl overflow-hidden border ${
                      m.glow
                        ? "border-neon-purple/60 shadow-[0_0_30px_rgba(168,85,247,0.35)]"
                        : "border-cyber-border"
                    } bg-gradient-to-b from-neon-purple/40 via-purple-900/40 to-cyber-dark`}
                  >
                    <span
                      className={`absolute top-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                        m.glow
                          ? "bg-success/20 text-success border border-success/40"
                          : "bg-black/40 text-white/80"
                      }`}
                    >
                      {m.score}
                    </span>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-9 h-9 rounded-full border-2 border-white/80 flex items-center justify-center">
                        <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                      </div>
                    </div>
                    <div className="absolute bottom-3 inset-x-2.5 space-y-1">
                      <div className="mx-auto w-4/5 h-1.5 rounded-full bg-white/90" />
                      <div className="mx-auto w-1/2 h-1.5 rounded-full bg-white/50" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-gradient-to-r from-neon-purple/60 to-electric-blue/60 p-[1px]">
        <div className="bg-cyber-card rounded-xl p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] text-cyber-muted mb-1">{t("clips.project")}</label>
            <select
              value={selProject}
              onChange={(e) => setSelProject(e.target.value)}
              className="w-full px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={detect}
            disabled={detecting || !selProject}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
          >
            {detecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {detecting ? t("clips.detecting") : t("clips.detect")}
          </button>
          <button
            onClick={captionFull}
            disabled={captioning || !selProject}
            title={t("clips.captionHint")}
            className="px-4 py-2.5 rounded-xl bg-cyber-dark border border-electric-blue/40 text-electric-blue text-sm font-medium hover:bg-electric-blue/10 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {captioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
            {t("clips.captionFull")}
          </button>
        </div>
        </div>
      )}

      {engine && (
        <p className="text-[11px] text-cyber-muted">
          {t("clips.engine")}: {engine}
        </p>
      )}

      {projClips.length > 0 && (
        <div className="grid gap-4">
          {projClips.map((clip) => (
            <div
              key={clip.id}
              className="bg-cyber-card border border-cyber-border rounded-xl p-4 space-y-3 hover:border-neon-purple/40 transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={`shrink-0 px-2 py-1 rounded-lg border text-xs font-bold ${scoreColor(clip.score)}`}
                  >
                    {clip.score}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{clip.title}</p>
                    <p className="text-[11px] text-cyber-muted mt-0.5">
                      {fmtClipTime(clip.startSec)}–{fmtClipTime(clip.endSec)} ·{" "}
                      {Math.round(clip.endSec - clip.startSec)}s
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => remove(clip)}
                  className="text-cyber-muted hover:text-danger transition-colors"
                  title={t("clips.delete")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-cyber-muted leading-relaxed">{clip.reason}</p>
              {clip.matched && (
                <p className="text-[11px] text-neon-purple bg-neon-purple/10 border border-neon-purple/30 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 shrink-0" />
                  {t("clips.matched")}: {clip.matched}
                </p>
              )}

              {clip.status === "suggested" || clip.status === "failed" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={styleSel[clip.id] ?? clip.style ?? "bold"}
                    onChange={(e) =>
                      setStyleSel((prev) => ({ ...prev, [clip.id]: e.target.value }))
                    }
                    className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
                  >
                    {CLIP_STYLES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {t("clips.captions")}: {s.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={posSel[clip.id] ?? clip.position ?? "bottom"}
                    onChange={(e) =>
                      setPosSel((prev) => ({ ...prev, [clip.id]: e.target.value }))
                    }
                    className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
                  >
                    {CLIP_POSITIONS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {t("clips.position")}: {p.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={focusSel[clip.id] ?? clip.focus ?? "center"}
                    onChange={(e) =>
                      setFocusSel((prev) => ({ ...prev, [clip.id]: e.target.value }))
                    }
                    className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
                  >
                    {CLIP_FOCUSES.map((f) => (
                      <option key={f.key} value={f.key}>
                        {t("clips.focus")}: {f.label}
                      </option>
                    ))}
                  </select>
                  <label
                    className="flex items-center gap-1.5 px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground cursor-pointer select-none"
                    title={t("clips.tightHint")}
                  >
                    <input
                      type="checkbox"
                      checked={tightSel[clip.id] ?? clip.tight !== 0}
                      onChange={(e) =>
                        setTightSel((prev) => ({ ...prev, [clip.id]: e.target.checked }))
                      }
                      className="accent-purple-500"
                    />
                    {t("clips.tight")}
                  </label>
                  <button
                    onClick={() => openPreview(clip)}
                    className="px-4 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs font-medium text-foreground hover:border-electric-blue/60 transition-colors flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" /> {t("clips.livePreview")}
                  </button>
                  <button
                    onClick={() => render(clip)}
                    className="px-4 py-2 rounded-lg bg-cyber-dark border border-neon-purple/40 text-xs font-medium text-neon-purple hover:bg-neon-purple/10 transition-colors flex items-center gap-1.5"
                  >
                    <Film className="w-3.5 h-3.5" />
                    {clip.status === "failed" ? t("clips.retry") : t("clips.render")}
                  </button>
                  {clip.status === "failed" && clip.error && (
                    <span className="text-[11px] text-danger">{clip.error}</span>
                  )}
                </div>
              ) : clip.status === "ready" ? (
                <div className="space-y-3">
                  <video
                    src={`/api/clips/${clip.id}/file`}
                    controls
                    preload="metadata"
                    className="w-full max-w-[240px] rounded-lg border border-cyber-border aspect-[9/16] bg-black"
                  />
                  <div className="flex flex-wrap items-end gap-2">
                    <a
                      href={`/api/clips/${clip.id}/file?download=1`}
                      className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs text-cyber-muted hover:text-foreground transition-colors flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" /> {t("clips.download")}
                    </a>
                    <select
                      value={
                        schedPlatform[clip.id] ??
                        schedPosts[clip.id]?.platform ??
                        lastPlatform("YouTube")
                      }
                      onChange={(e) =>
                        setSchedPlatform((prev) => ({ ...prev, [clip.id]: e.target.value }))
                      }
                      className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
                    >
                      {["YouTube", "TikTok"].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <SchedTimeField
                      value={
                        schedAt[clip.id] ??
                        (schedPosts[clip.id]
                          ? toLocalInput(new Date(schedPosts[clip.id].scheduledAt))
                          : defaultAt)
                      }
                      onChange={(v) => setSchedAt((prev) => ({ ...prev, [clip.id]: v }))}
                    />
                    {!schedPosts[clip.id] ? (
                      <button
                        onClick={() => schedule(clip)}
                        className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5"
                      >
                        <Calendar className="w-3.5 h-3.5" /> {t("clips.schedule")}
                      </button>
                    ) : hasPendingChange(clip.id) ? (
                      /* Appears the moment the time or platform is edited. */
                      <button
                        onClick={() => schedule(clip)}
                        className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium ring-2 ring-neon-purple/60 animate-pulse hover:animate-none hover:opacity-90 flex items-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" /> {t("clips.apply")}
                      </button>
                    ) : null}
                    <button
                      onClick={() => genThumb(clip)}
                      disabled={thumbs[clip.id]?.busy}
                      className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs text-cyber-muted hover:text-foreground hover:border-electric-blue/50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {thumbs[clip.id]?.busy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      {t("clips.thumb")}
                    </button>
                  </div>
                  {schedPosts[clip.id] && (
                    <p className="text-[11px] text-success">
                      {t("clips.scheduledFor", {
                        when: new Date(schedPosts[clip.id].scheduledAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }),
                        p: schedPosts[clip.id].platform,
                      })}
                    </p>
                  )}
                  {thumbs[clip.id]?.id && (
                    <div className="space-y-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/images/${thumbs[clip.id].id}`}
                        alt=""
                        className="w-full max-w-[320px] rounded-lg border border-cyber-border"
                      />
                      <a
                        href={`/api/images/${thumbs[clip.id].id}`}
                        download={`thumbnail-${clip.id}.png`}
                        className="text-xs text-electric-blue hover:underline inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" /> {t("clips.thumbDownload")}
                      </a>
                    </div>
                  )}
                  {connections &&
                    !isConnected(connections, schedPlatform[clip.id] ?? lastPlatform("YouTube")) && (
                      <p className="text-[11px] text-warning flex flex-wrap items-center gap-1.5">
                        {t("sched.demoNote", {
                          platform: schedPlatform[clip.id] ?? lastPlatform("YouTube"),
                        })}
                        <button
                          onClick={() => onNavigate?.()}
                          className="underline hover:text-foreground transition-colors"
                        >
                          {t("sched.connectNow")}
                        </button>
                      </p>
                    )}
                </div>
              ) : (
                <p className="text-xs text-electric-blue flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {clip.status === "queued" ? t("clips.queuedStatus") : t("clips.rendering")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Script videos: TTS-narrated, caption-burned — no recording involved */}
      {svClips.length > 0 && (
        <div className="pt-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Film className="w-4 h-4 text-electric-blue" /> {t("clips.svTitle")}
          </h3>
          <div className="grid gap-4">
            {svClips.map((clip) => (
              <div
                key={clip.id}
                className="bg-cyber-card border border-cyber-border rounded-xl p-4 space-y-3 hover:border-neon-purple/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{clip.title}</p>
                  <button
                    onClick={() => remove(clip)}
                    className="text-cyber-muted hover:text-danger transition-colors shrink-0"
                    title={t("clips.delete")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {clip.status === "ready" ? (
                  <div className="space-y-3">
                    <video
                      src={`/api/clips/${clip.id}/file`}
                      controls
                      preload="metadata"
                      className="w-full max-w-[240px] rounded-lg border border-cyber-border aspect-[9/16] bg-black"
                    />
                    <div className="flex flex-wrap items-end gap-2">
                      <a
                        href={`/api/clips/${clip.id}/file?download=1`}
                        className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs text-cyber-muted hover:text-foreground transition-colors flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" /> {t("clips.download")}
                      </a>
                      <select
                        value={
                          schedPlatform[clip.id] ??
                          schedPosts[clip.id]?.platform ??
                          lastPlatform("YouTube")
                        }
                        onChange={(e) =>
                          setSchedPlatform((prev) => ({ ...prev, [clip.id]: e.target.value }))
                        }
                        className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
                      >
                        {["YouTube", "TikTok"].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <SchedTimeField
                        value={
                          schedAt[clip.id] ??
                          (schedPosts[clip.id]
                            ? toLocalInput(new Date(schedPosts[clip.id].scheduledAt))
                            : defaultAt)
                        }
                        onChange={(v) => setSchedAt((prev) => ({ ...prev, [clip.id]: v }))}
                      />
                      {!schedPosts[clip.id] ? (
                        <button
                          onClick={() => schedule(clip)}
                          className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5"
                        >
                          <Calendar className="w-3.5 h-3.5" /> {t("clips.schedule")}
                        </button>
                      ) : hasPendingChange(clip.id) ? (
                        /* Appears the moment the time or platform is edited. */
                        <button
                          onClick={() => schedule(clip)}
                          className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium ring-2 ring-neon-purple/60 animate-pulse hover:animate-none hover:opacity-90 flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" /> {t("clips.apply")}
                        </button>
                      ) : null}
                      <button
                        onClick={() => genThumb(clip)}
                        disabled={thumbs[clip.id]?.busy}
                        className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs text-cyber-muted hover:text-foreground hover:border-electric-blue/50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {thumbs[clip.id]?.busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        {t("clips.thumb")}
                      </button>
                    </div>
                    {schedPosts[clip.id] && (
                      <p className="text-[11px] text-success">
                        {t("clips.scheduledFor", {
                          when: new Date(schedPosts[clip.id].scheduledAt).toLocaleString(
                            undefined,
                            { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
                          ),
                          p: schedPosts[clip.id].platform,
                        })}
                      </p>
                    )}
                    {thumbs[clip.id]?.id && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/api/images/${thumbs[clip.id].id}`}
                        alt=""
                        className="w-full max-w-[320px] rounded-lg border border-cyber-border"
                      />
                    )}
                  </div>
                ) : clip.status === "failed" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-danger">{clip.error}</span>
                    <button
                      onClick={() => render(clip)}
                      className="px-3 py-1.5 rounded-lg bg-cyber-dark border border-neon-purple/40 text-xs font-medium text-neon-purple hover:bg-neon-purple/10 transition-colors"
                    >
                      {t("clips.retry")}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-electric-blue flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {clip.status === "queued" ? t("clips.svQueued") : t("clips.svRendering")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ambient loops: sleep-length seamless renders — still + glacial
          drift + synthesized soundscape. The anti-documentary style. */}
      <div className="pt-4">
        <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Moon className="w-4 h-4 text-electric-blue" /> {t("amb.title")}
        </h3>
        <p className="text-xs text-cyber-muted mb-3">{t("amb.sub")}</p>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <input
            type="text"
            value={ambTheme}
            onChange={(e) => setAmbTheme(e.target.value)}
            placeholder={t("amb.themePh")}
            className="flex-1 min-w-[220px] px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
          />
          <select
            value={ambMinutes}
            onChange={(e) => setAmbMinutes(Number(e.target.value))}
            className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            {[15, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <select
            value={ambScape}
            onChange={(e) => setAmbScape(e.target.value)}
            className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            <option value="ocean">{t("amb.ocean")}</option>
            <option value="thunder">{t("amb.thunder")}</option>
            <option value="rain">{t("amb.rain")}</option>
            <option value="waterfall">{t("amb.waterfall")}</option>
            <option value="brown-noise">{t("amb.brownNoise")}</option>
            <option value="wind">{t("amb.wind")}</option>
            <option value="binaural">{t("amb.binaural")}</option>
            <option value="purr">{t("amb.purr")}</option>
          </select>
          <button
            onClick={createAmbient}
            disabled={ambBusy || ambTheme.trim().length < 3}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {ambBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Moon className="w-3.5 h-3.5" />}
            {t("amb.create")}
          </button>
        </div>

        {ambClips.length > 0 && (
          <div className="grid gap-4">
            {ambClips.map((clip) => (
              <div
                key={clip.id}
                className="bg-cyber-card border border-cyber-border rounded-xl p-4 space-y-3 hover:border-electric-blue/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{clip.title}</p>
                  <button
                    onClick={() => remove(clip)}
                    className="text-cyber-muted hover:text-danger transition-colors shrink-0"
                    title={t("clips.delete")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {clip.status === "ready" ? (
                  <div className="space-y-3">
                    <video
                      src={`/api/clips/${clip.id}/file`}
                      controls
                      preload="metadata"
                      className="w-full max-w-[480px] rounded-lg border border-cyber-border aspect-video bg-black"
                    />
                    <div className="flex flex-wrap items-end gap-2">
                      <a
                        href={`/api/clips/${clip.id}/file?download=1`}
                        className="inline-flex px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs text-cyber-muted hover:text-foreground transition-colors items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" /> {t("clips.download")}
                      </a>
                      {/* Long-form goes to YouTube only (Shorts/TikTok caps
                          are minutes, not hours) — uploaded without #Shorts. */}
                      <span className="px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-cyber-muted">
                        YouTube
                      </span>
                      <SchedTimeField
                        value={
                          schedAt[clip.id] ??
                          (schedPosts[clip.id]
                            ? toLocalInput(new Date(schedPosts[clip.id].scheduledAt))
                            : defaultAt)
                        }
                        onChange={(v) => setSchedAt((prev) => ({ ...prev, [clip.id]: v }))}
                      />
                      {!schedPosts[clip.id] ? (
                        <button
                          onClick={() => schedule(clip)}
                          className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5"
                        >
                          <Calendar className="w-3.5 h-3.5" /> {t("clips.schedule")}
                        </button>
                      ) : hasPendingChange(clip.id) ? (
                        <button
                          onClick={() => schedule(clip)}
                          className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium ring-2 ring-neon-purple/60 animate-pulse hover:animate-none hover:opacity-90 flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" /> {t("clips.apply")}
                        </button>
                      ) : null}
                    </div>
                    {schedPosts[clip.id] && (
                      <p className="text-[11px] text-success">
                        {t("clips.scheduledFor", {
                          when: new Date(schedPosts[clip.id].scheduledAt).toLocaleString(
                            undefined,
                            { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
                          ),
                          p: schedPosts[clip.id].platform,
                        })}
                      </p>
                    )}
                  </div>
                ) : clip.status === "failed" ? (
                  <span className="text-[11px] text-danger">{clip.error}</span>
                ) : (
                  <p className="text-xs text-electric-blue flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t("amb.rendering")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <ClipPreviewModal
          clip={preview.clip}
          words={preview.words}
          style={styleSel[preview.clip.id] ?? preview.clip.style ?? "bold"}
          position={posSel[preview.clip.id] ?? preview.clip.position ?? "bottom"}
          focus={focusSel[preview.clip.id] ?? preview.clip.focus ?? "center"}
          tight={tightSel[preview.clip.id] ?? preview.clip.tight !== 0}
          onStyleChange={(s) =>
            setStyleSel((prev) => ({ ...prev, [preview.clip.id]: s }))
          }
          onPositionChange={(p) =>
            setPosSel((prev) => ({ ...prev, [preview.clip.id]: p }))
          }
          onFocusChange={(f) =>
            setFocusSel((prev) => ({ ...prev, [preview.clip.id]: f }))
          }
          onRender={() => {
            render(preview.clip);
            setPreview(null);
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

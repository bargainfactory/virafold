"use client";

/**
 * The Cutting Room: a full-page editing dashboard for one rendered film.
 * Player + beat filmstrip + inspector, with the manual tools that survive a
 * voice-locked pipeline: audio mixer faders, per-boundary transitions, grade
 * presets, speed/freeze, manual Ken Burns paths, margin notes, and a
 * non-destructive take history with one-click revert. Conversational edits
 * and re-rolls ride the existing edit-beat machinery.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import {
  Clapperboard,
  Film,
  Flag,
  History,
  Loader2,
  MessageSquareText,
  Music,
  RefreshCw,
  Scissors,
  StickyNote,
  Wand2,
  X,
} from "lucide-react";

/** One planned Director's Notes step, as the /direct endpoint returns it. */
interface DirStep {
  action: "mix" | "fx" | "shot" | "edit" | "note";
  index: number | null;
  label: string;
  [k: string]: unknown;
}
const STEP_COST: Record<DirStep["action"], "free" | "re-encode" | "regenerate"> = {
  note: "free",
  mix: "re-encode",
  fx: "re-encode",
  shot: "regenerate",
  edit: "regenerate",
};

interface CutBeat {
  i: number;
  text: string;
  start: number;
  dur: number;
  kind: string;
  file: string;
  preview: string | null;
  image: boolean;
  frame: boolean;
  song: boolean;
  who: string[];
  fx: { grade?: string; speed?: number; freeze?: boolean; kb?: Record<string, number> } | null;
  fadeIn: boolean;
  fadeOut: boolean;
  note: string;
  versions: string[];
}

interface CutFilm {
  wide: boolean;
  duration: number;
  lead: number;
  mix: { voice: number; music: number; amb: number; duck: number };
  hasMusic: boolean;
  hasAmbience: boolean;
  beats: CutBeat[];
}

const GRADES = ["", "warm", "cool", "night", "golden", "dream"] as const;
const SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const;
const KB_PRESETS: { key: string; label: string; kb: Record<string, number> | null }[] = [
  { key: "auto", label: "Auto camera", kb: null },
  { key: "pushin", label: "Push in", kb: { z0: 1.0, x0: 0.5, y0: 0.5, z1: 1.25, x1: 0.5, y1: 0.5 } },
  { key: "pullout", label: "Pull out", kb: { z0: 1.25, x0: 0.5, y0: 0.5, z1: 1.0, x1: 0.5, y1: 0.5 } },
  { key: "panlr", label: "Pan left → right", kb: { z0: 1.15, x0: 0.1, y0: 0.5, z1: 1.15, x1: 0.9, y1: 0.5 } },
  { key: "panrl", label: "Pan right → left", kb: { z0: 1.15, x0: 0.9, y0: 0.5, z1: 1.15, x1: 0.1, y1: 0.5 } },
  { key: "rise", label: "Rise (tilt up)", kb: { z0: 1.15, x0: 0.5, y0: 0.85, z1: 1.15, x1: 0.5, y1: 0.15 } },
];

export default function CuttingRoom({
  clipId,
  title,
  onClose,
  onEdited,
}: {
  clipId: string;
  title: string;
  onClose: () => void;
  onEdited: () => void;
}) {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [film, setFilm] = useState<CutFilm | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bust, setBust] = useState(0);
  const [mix, setMix] = useState({ voice: 1, music: 0.32, amb: 0.14, duck: 6 });
  const [note, setNote] = useState("");
  const [instruction, setInstruction] = useState("");
  const [shot, setShot] = useState<Record<string, string | undefined>>({});
  const [rate, setRate] = useState(1);
  // Director's Notes: plain-language wishes → reviewed checklist → apply.
  const [dirText, setDirText] = useState("");
  const [dirSteps, setDirSteps] = useState<DirStep[] | null>(null);
  const [dirOn, setDirOn] = useState<boolean[]>([]);
  const [dirBusy, setDirBusy] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  // Preview-only fast forward: changes playbackRate on the player, never the
  // rendered film (per-beat SPEED re-encodes; this just reviews faster).
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate, bust]);

  const load = useCallback(() => {
    fetch(`/api/clips/${clipId}/cut`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CutFilm | null) => {
        if (!d) return;
        setFilm(d);
        setMix(d.mix);
      })
      .catch(() => {});
  }, [clipId]);
  useEffect(() => load(), [load]);

  const beat = useMemo(() => film?.beats.find((b) => b.i === sel) ?? null, [film, sel]);
  useEffect(() => setNote(beat?.note ?? ""), [beat?.i]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = useCallback(
    async (op: string, payload: Record<string, unknown>, refreshVideo = true) => {
      if (busy) return false;
      setBusy(op);
      try {
        const res = await fetch(`/api/clips/${clipId}/cut`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, ...payload }),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          addToast(d?.error ?? t("clips.renderFailed"), "error");
          return false;
        }
        addToast(t("cut.applied"));
        load();
        if (refreshVideo) {
          setBust((v) => v + 1);
          onEdited();
        }
        return true;
      } finally {
        setBusy(null);
      }
    },
    [busy, clipId, addToast, t, load, onEdited]
  );

  const seek = useCallback(
    (b: CutBeat) => {
      setSel(b.i);
      const v = videoRef.current;
      if (v && film) {
        v.currentTime = film.lead + b.start + 0.05;
        v.play().catch(() => {});
      }
    },
    [film]
  );

  // Tap-to-flag: mark the moment you're watching — the player timestamp maps
  // to its beat, the inspector opens on it, and the note starts with the time.
  const flagMoment = useCallback(() => {
    const v = videoRef.current;
    if (!v || !film) return;
    v.pause();
    const t = Math.max(0, v.currentTime - film.lead);
    const b =
      film.beats.find((x) => t >= x.start && t < x.start + x.dur) ??
      film.beats[film.beats.length - 1];
    if (!b) return;
    setSel(b.i);
    const mm = Math.floor(v.currentTime / 60);
    const ss = String(Math.floor(v.currentTime % 60)).padStart(2, "0");
    setNote((cur) => (cur ? cur : `[${mm}:${ss}] `));
    setTimeout(() => noteRef.current?.focus(), 50);
  }, [film]);

  const planNotes = useCallback(async () => {
    if (dirBusy || dirText.trim().length < 5) return;
    setDirBusy("plan");
    setDirSteps(null);
    try {
      const res = await fetch(`/api/clips/${clipId}/direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: dirText.trim() }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        addToast(d?.error ?? t("clips.renderFailed"), "error");
        return;
      }
      const steps = (d?.steps ?? []) as DirStep[];
      setDirSteps(steps);
      setDirOn(steps.map(() => true));
    } finally {
      setDirBusy(null);
    }
  }, [dirBusy, dirText, clipId, addToast, t]);

  const applyNotes = useCallback(async () => {
    if (!film || !dirSteps || dirBusy) return;
    const todo = dirSteps.filter((_, i) => dirOn[i]);
    if (!todo.length) return;
    let failed = 0;
    for (let i = 0; i < todo.length; i++) {
      const s = todo[i];
      setDirBusy(`${i + 1}/${todo.length}`);
      const num = (x: unknown): number | undefined => (typeof x === "number" ? x : undefined);
      const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
      try {
        let res: Response;
        if (s.action === "edit") {
          res = await fetch(`/api/clips/${clipId}/edit-beat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: s.index, mode: "prompt", instruction: str(s.instruction) ?? s.label }),
          });
        } else {
          let payload: Record<string, unknown> = {};
          if (s.action === "mix") {
            payload = {
              op: "mix",
              voice: num(s.voice) ?? mix.voice,
              music: num(s.music) ?? mix.music,
              amb: num(s.amb) ?? mix.amb,
              duck: num(s.duck) ?? mix.duck,
            };
          } else if (s.action === "fx") {
            const b = film.beats.find((x) => x.i === s.index);
            const fx: Record<string, unknown> = { ...(b?.fx ?? {}) };
            const g = str(s.grade);
            if (g !== undefined) {
              if (g) fx.grade = g;
              else delete fx.grade;
            }
            if (num(s.speed) !== undefined) fx.speed = num(s.speed);
            if (typeof s.freeze === "boolean") fx.freeze = s.freeze;
            payload = {
              op: "fx",
              index: s.index,
              fx: Object.keys(fx).length ? fx : null,
              fadeIn: typeof s.fadeIn === "boolean" ? s.fadeIn : b?.fadeIn === true,
              fadeOut: typeof s.fadeOut === "boolean" ? s.fadeOut : b?.fadeOut === true,
            };
          } else if (s.action === "shot") {
            const shotCard: Record<string, string> = {};
            for (const k of ["size", "angle", "light", "move"] as const) {
              const v = str(s[k]);
              if (v) shotCard[k] = v;
            }
            payload = { op: "shot", index: s.index, shot: shotCard };
          } else {
            payload = { op: "note", index: s.index, note: str(s.note) ?? s.label };
          }
          res = await fetch(`/api/clips/${clipId}/cut`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    setDirBusy(null);
    setDirSteps(null);
    setDirText("");
    load();
    setBust((v) => v + 1);
    onEdited();
    addToast(failed ? t("cut.dn.partial").replace("{n}", String(failed)) : t("cut.dn.done"), failed ? "error" : undefined);
  }, [film, dirSteps, dirOn, dirBusy, clipId, mix, load, onEdited, addToast, t]);

  const editBeat = useCallback(
    async (mode: "prompt" | "reroll") => {
      if (!beat || busy) return;
      setBusy("edit");
      try {
        const res = await fetch(`/api/clips/${clipId}/edit-beat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            index: beat.i,
            mode,
            ...(mode === "prompt" ? { instruction: instruction.trim() } : {}),
          }),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok) addToast(d?.error ?? t("clips.renderFailed"), "error");
        else {
          addToast(t("cut.applied"));
          setInstruction("");
          setBust((v) => v + 1);
          load();
          onEdited();
        }
      } finally {
        setBusy(null);
      }
    },
    [beat, busy, clipId, instruction, addToast, t, load, onEdited]
  );

  const kbKey = useMemo(() => {
    if (!beat?.fx?.kb) return "auto";
    const hit = KB_PRESETS.find(
      (p) => p.kb && Object.entries(p.kb).every(([k, v]) => Math.abs((beat.fx!.kb as Record<string, number>)[k] - v) < 0.01)
    );
    return hit?.key ?? "custom";
  }, [beat]);

  const applyFx = useCallback(
    (patch: Partial<{ grade: string; speed: number; freeze: boolean; kb: Record<string, number> | null; fadeIn: boolean; fadeOut: boolean }>) => {
      if (!beat) return;
      const cur = beat.fx ?? {};
      const next: Record<string, unknown> = { ...cur };
      if ("grade" in patch) {
        if (patch.grade) next.grade = patch.grade;
        else delete next.grade;
      }
      if ("speed" in patch) {
        if (patch.speed && patch.speed !== 1) next.speed = patch.speed;
        else delete next.speed;
      }
      if ("freeze" in patch) {
        if (patch.freeze) next.freeze = true;
        else delete next.freeze;
      }
      if ("kb" in patch) {
        if (patch.kb) next.kb = patch.kb;
        else delete next.kb;
      }
      const fadeIn = "fadeIn" in patch ? patch.fadeIn === true : beat.fadeIn;
      const fadeOut = "fadeOut" in patch ? patch.fadeOut === true : beat.fadeOut;
      void post("fx", {
        index: beat.i,
        fx: Object.keys(next).length ? next : null,
        fadeIn,
        fadeOut,
      });
    },
    [beat, post]
  );

  if (!film) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-neon-purple" />
      </div>
    );
  }

  const pxPerSec = 14;
  return (
    <div className="fixed inset-0 z-50 bg-cyber-dark flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-cyber-border shrink-0">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Scissors className="w-4 h-4 text-neon-purple" /> {t("cut.title")} — {title}
        </h2>
        <button onClick={onClose} className="text-cyber-muted hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left rail: the mixer */}
        <div className="w-56 shrink-0 border-r border-cyber-border p-4 space-y-4 overflow-y-auto">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-electric-blue" /> {t("cut.mixer")}
          </h3>
          {(
            [
              ["voice", 0.5, 1.6, 0.05],
              ["music", 0, 0.8, 0.02],
              ["amb", 0, 0.5, 0.02],
              ["duck", 1, 12, 0.5],
            ] as const
          ).map(([k, lo, hi, step]) => (
            <label key={k} className="block text-[11px] text-cyber-muted">
              {t(`cut.mix.${k}`)}
              <span className="float-right tabular-nums text-foreground">{mix[k].toFixed(2)}</span>
              <input
                type="range"
                min={lo}
                max={hi}
                step={step}
                value={mix[k]}
                disabled={(k === "music" && !film.hasMusic) || (k === "amb" && !film.hasAmbience)}
                onChange={(e) => setMix((m) => ({ ...m, [k]: Number(e.target.value) }))}
                className="w-full accent-fuchsia-400"
              />
            </label>
          ))}
          <button
            onClick={() => void post("mix", mix)}
            disabled={busy !== null}
            className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy === "mix" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Music className="w-3.5 h-3.5" />}
            {t("cut.applyMix")}
          </button>
          <p className="text-[10px] text-cyber-muted leading-snug">{t("cut.mixHint")}</p>

          {/* Director's Notes: say it, review the steps, apply */}
          <div className="pt-3 border-t border-cyber-border space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <MessageSquareText className="w-3.5 h-3.5 text-neon-purple" /> {t("cut.dn.title")}
            </p>
            <textarea
              value={dirText}
              onChange={(e) => setDirText(e.target.value)}
              placeholder={t("cut.dn.ph")}
              rows={3}
              className="w-full px-2.5 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs text-foreground placeholder:text-cyber-muted resize-none"
            />
            <button
              onClick={() => void planNotes()}
              disabled={dirBusy !== null || dirText.trim().length < 5}
              className="w-full px-3 py-2 rounded-lg bg-cyber-dark border border-neon-purple/50 text-neon-purple text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5 hover:bg-neon-purple/10"
            >
              {dirBusy === "plan" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {t("cut.dn.plan")}
            </button>
            {dirSteps && (
              <div className="space-y-1.5">
                {dirSteps.map((s, i) => (
                  <label key={i} className="flex items-start gap-2 text-[11px] text-foreground/90 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dirOn[i] ?? true}
                      onChange={(e) => setDirOn((v) => v.map((x, j) => (j === i ? e.target.checked : x)))}
                      className="mt-0.5 accent-fuchsia-500"
                    />
                    <span>
                      {s.label}
                      <span className={`ml-1.5 text-[9px] uppercase tracking-wide ${STEP_COST[s.action] === "regenerate" ? "text-warning" : "text-cyber-muted"}`}>
                        {t(`cut.dn.cost.${STEP_COST[s.action]}`)}
                      </span>
                    </span>
                  </label>
                ))}
                <button
                  onClick={() => void applyNotes()}
                  disabled={dirBusy !== null || !dirOn.some(Boolean)}
                  className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {dirBusy && dirBusy !== "plan" ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {dirBusy}
                    </>
                  ) : (
                    t("cut.dn.apply").replace("{n}", String(dirOn.filter(Boolean).length))
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: player + filmstrip */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 bg-black flex items-center justify-center p-3">
            <video
              ref={videoRef}
              key={bust}
              src={`/api/clips/${clipId}/file?v=${bust}`}
              controls
              onLoadedMetadata={(e) => {
                e.currentTarget.playbackRate = rate;
              }}
              className="max-h-full max-w-full rounded-lg"
            />
          </div>
          {/* Preview speed + tap-to-flag: review fast-forward, never re-encodes */}
          <div className="shrink-0 flex items-center justify-center gap-1.5 py-1.5 border-t border-cyber-border">
            <button
              onClick={flagMoment}
              title={t("cut.flagHint")}
              className="px-2.5 py-0.5 rounded-full text-[11px] border border-warning/60 text-warning hover:bg-warning/10 flex items-center gap-1 mr-2"
            >
              <Flag className="w-3 h-3" /> {t("cut.flag")}
            </button>
            <span className="text-[10px] uppercase tracking-wide text-cyber-muted mr-1">{t("cut.playback")}</span>
            {[0.5, 1, 1.5, 2, 4].map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                className={`px-2 py-0.5 rounded-full text-[11px] border ${
                  rate === r
                    ? "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-400/10"
                    : "border-cyber-border text-cyber-muted hover:text-foreground"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
          {/* Filmstrip: width ∝ duration, color-coded; click = seek + select */}
          <div className="h-36 shrink-0 border-t border-cyber-border overflow-x-auto overflow-y-hidden">
            <div className="flex h-full items-stretch px-2 py-2 gap-px" style={{ width: "max-content" }}>
              {film.beats.map((b) => (
                <button
                  key={b.i}
                  onClick={() => seek(b)}
                  title={`#${b.i + 1} · ${b.text.slice(0, 80)}`}
                  className={`relative shrink-0 rounded overflow-hidden border ${
                    sel === b.i ? "border-fuchsia-400 ring-2 ring-fuchsia-400/40" : "border-cyber-border"
                  }`}
                  style={{ width: Math.max(34, b.dur * pxPerSec) }}
                >
                  {b.preview ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/clips/${clipId}/plan?asset=${encodeURIComponent(b.preview)}&v=${bust}`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full bg-cyber-dark text-cyber-muted">
                      <Film className="w-4 h-4" />
                    </span>
                  )}
                  <span
                    className={`absolute inset-x-0 bottom-0 h-1.5 ${
                      b.song ? "bg-amber-400" : b.kind === "speak" ? "bg-fuchsia-400" : b.frame ? "bg-electric-blue" : "bg-success/70"
                    }`}
                  />
                  {(b.fx || b.fadeIn || b.fadeOut || b.note) && (
                    <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-warning" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: inspector */}
        <div className="w-80 shrink-0 border-l border-cyber-border p-4 space-y-3 overflow-y-auto">
          {!beat ? (
            <p className="text-xs text-cyber-muted">{t("cut.pick")}</p>
          ) : (
            <>
              <p className="text-[11px] text-cyber-muted">
                #{beat.i + 1} · {Math.round(beat.start)}s · {beat.dur.toFixed(1)}s · {beat.kind}
                {beat.who.length ? ` · ${beat.who.join(", ")}` : ""}
              </p>
              <p className="text-[11px] text-foreground/90 leading-snug line-clamp-3">{beat.text}</p>

              {/* Conversational edit + re-roll (the cutaway/insert tool) */}
              <div className="flex gap-1">
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && instruction.trim().length >= 3 && void editBeat("prompt")}
                  placeholder={t("ed.promptPh")}
                  className="flex-1 min-w-0 px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-[11px] text-foreground focus:outline-none focus:border-fuchsia-500/50"
                />
                <button
                  onClick={() => void editBeat("prompt")}
                  disabled={busy !== null || instruction.trim().length < 3}
                  title={t("ed.prompt")}
                  className="px-2 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-fuchsia-300 disabled:opacity-50"
                >
                  {busy === "edit" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => void editBeat("reroll")}
                  disabled={busy !== null}
                  title={t("ed.reroll")}
                  className="px-2 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-cyber-muted hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Director's Chair: re-shoot with a manual shot card */}
              {beat.image && (
                <div className="rounded-lg border border-neon-purple/30 bg-neon-purple/5 p-2 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-neon-purple flex items-center gap-1">
                    <Clapperboard className="w-3 h-3" /> {t("cut.chair")}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        ["size", ["", "ecu", "cu", "ms", "ws", "ews"]],
                        ["angle", ["", "eye", "low", "high", "overhead", "pov"]],
                        ["light", ["", "golden", "noon", "night", "dawn", "firelight", "storm"]],
                        ["move", ["", "static", "push", "pull", "panlr", "panrl", "rise"]],
                      ] as const
                    ).map(([field, opts]) => (
                      <select
                        key={field}
                        value={shot[field] ?? ""}
                        onChange={(e) => setShot((s) => ({ ...s, [field]: e.target.value || undefined }))}
                        className="px-1.5 py-1 bg-cyber-dark border border-cyber-border rounded text-[10px] text-foreground focus:outline-none"
                      >
                        <option value="">{t(`cut.shot.${field}`)}</option>
                        {opts.filter(Boolean).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>
                  <button
                    onClick={() => void post("shot", { index: beat.i, shot })}
                    disabled={busy !== null || !Object.values(shot).some(Boolean)}
                    className="w-full px-2 py-1.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-[11px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {busy === "shot" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clapperboard className="w-3 h-3" />}
                    {t("cut.reshoot")}
                  </button>
                </div>
              )}

              {/* Grade */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-cyber-muted mb-1">{t("cut.grade")}</p>
                <div className="flex flex-wrap gap-1">
                  {GRADES.map((g) => (
                    <button
                      key={g || "none"}
                      onClick={() => applyFx({ grade: g })}
                      disabled={busy !== null}
                      className={`px-2 py-1 rounded-full text-[10px] border ${
                        (beat.fx?.grade ?? "") === g
                          ? "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-500/10"
                          : "border-cyber-border text-cyber-muted hover:text-foreground"
                      }`}
                    >
                      {g || t("cut.none")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Speed / freeze (video beats) */}
              {!beat.image && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-cyber-muted mb-1">{t("cut.speed")}</p>
                  <div className="flex flex-wrap gap-1 items-center">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => applyFx({ speed: s, freeze: false })}
                        disabled={busy !== null}
                        className={`px-2 py-1 rounded-full text-[10px] border ${
                          (beat.fx?.speed ?? 1) === s && !beat.fx?.freeze
                            ? "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-500/10"
                            : "border-cyber-border text-cyber-muted hover:text-foreground"
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                    <button
                      onClick={() => applyFx({ freeze: !beat.fx?.freeze })}
                      disabled={busy !== null}
                      className={`px-2 py-1 rounded-full text-[10px] border ${
                        beat.fx?.freeze
                          ? "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-500/10"
                          : "border-cyber-border text-cyber-muted hover:text-foreground"
                      }`}
                    >
                      {t("cut.freeze")}
                    </button>
                  </div>
                </div>
              )}

              {/* Manual Ken Burns (stills) */}
              {beat.image && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-cyber-muted mb-1">{t("cut.camera")}</p>
                  <div className="flex flex-wrap gap-1">
                    {KB_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => applyFx({ kb: p.kb })}
                        disabled={busy !== null}
                        className={`px-2 py-1 rounded-full text-[10px] border ${
                          kbKey === p.key
                            ? "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-500/10"
                            : "border-cyber-border text-cyber-muted hover:text-foreground"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Transitions */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-cyber-muted mb-1">{t("cut.transition")}</p>
                <div className="flex gap-1">
                  <button
                    onClick={() => applyFx({ fadeIn: !beat.fadeIn })}
                    disabled={busy !== null}
                    className={`px-2 py-1 rounded-full text-[10px] border ${
                      beat.fadeIn ? "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-500/10" : "border-cyber-border text-cyber-muted"
                    }`}
                  >
                    {t("cut.fadeIn")}
                  </button>
                  <button
                    onClick={() => applyFx({ fadeOut: !beat.fadeOut })}
                    disabled={busy !== null}
                    className={`px-2 py-1 rounded-full text-[10px] border ${
                      beat.fadeOut ? "border-fuchsia-400 text-fuchsia-300 bg-fuchsia-500/10" : "border-cyber-border text-cyber-muted"
                    }`}
                  >
                    {t("cut.fadeOut")}
                  </button>
                </div>
              </div>

              {/* Take history */}
              {beat.versions.length > 1 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-cyber-muted mb-1 flex items-center gap-1">
                    <History className="w-3 h-3" /> {t("cut.takes")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {beat.versions.map((v) => (
                      <button
                        key={v}
                        onClick={() => void post("revert", { index: beat.i, file: v })}
                        disabled={busy !== null || v === beat.file}
                        title={v}
                        className={`rounded-lg overflow-hidden border w-16 h-10 ${
                          v === beat.file ? "border-fuchsia-400" : "border-cyber-border opacity-80 hover:opacity-100"
                        }`}
                      >
                        {v.endsWith(".png") ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={`/api/clips/${clipId}/plan?asset=${encodeURIComponent(v)}&v=${bust}`} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="flex items-center justify-center w-full h-full text-cyber-muted">
                            <Film className="w-4 h-4" />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Margin note */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-cyber-muted mb-1 flex items-center gap-1">
                  <StickyNote className="w-3 h-3" /> {t("cut.note")}
                </p>
                <div className="flex gap-1">
                  <input
                    ref={noteRef}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("cut.notePh")}
                    className="flex-1 min-w-0 px-2 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-[11px] text-foreground focus:outline-none"
                  />
                  <button
                    onClick={() => void post("note", { index: beat.i, note }, false)}
                    disabled={busy !== null}
                    className="px-2 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-[11px] text-cyber-muted hover:text-foreground disabled:opacity-50"
                  >
                    {busy === "note" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "✓"}
                  </button>
                </div>
              </div>

              {busy === "fx" || busy === "revert" ? (
                <p className="text-[11px] text-electric-blue flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("cut.working")}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

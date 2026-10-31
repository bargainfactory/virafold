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
  History,
  Loader2,
  Music,
  RefreshCw,
  Scissors,
  StickyNote,
  Wand2,
  X,
} from "lucide-react";

interface CutBeat {
  i: number;
  text: string;
  start: number;
  dur: number;
  kind: string;
  file: string;
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
  const videoRef = useRef<HTMLVideoElement>(null);

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
        </div>

        {/* Center: player + filmstrip */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 bg-black flex items-center justify-center p-3">
            <video
              ref={videoRef}
              key={bust}
              src={`/api/clips/${clipId}/file?v=${bust}`}
              controls
              className="max-h-full max-w-full rounded-lg"
            />
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/clips/${clipId}/plan?asset=${encodeURIComponent(b.file)}&v=${bust}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
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

"use client";

/**
 * Production Desk: the pre-render control room. Everything here is staged by
 * cost so the user sees what each dollar buys BEFORE spending it:
 *   1. Checklist  (free, instant)  — what the words will make the engine do
 *   2. Blueprint  (cents)          — cast designs, voices, per-line presence
 *   3. Look       (~fifty cents)   — three real poster frames + voice sampler
 * The expensive stages (storyboard draft render, scene edits, Animate Film)
 * already live in the clips flow; this desk is the gate in front of them.
 */

import { useCallback, useMemo, useState } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { lintScript, type ScriptLint } from "@/lib/script-lint";
import { Check, ClipboardList, Eye, Loader2, Palette, Volume2, X } from "lucide-react";

interface StoryChar {
  name: string;
  design: string;
  aliases: string[];
}

interface Blueprint {
  lint: ScriptLint;
  voices: Record<string, string | null>;
  storyCast: StoryChar[];
  storyProps: { name: string; design: string; keywords: string[] }[];
  presence: string[][];
}

interface LookPreview {
  posters: { line: string; b64: string }[];
  samples: { speaker: string; b64: string }[];
  storyCast: StoryChar[];
}

export default function ProductionDesk({
  script,
  title,
  props,
  wide,
}: {
  script: string;
  title: string;
  props: string[];
  wide?: boolean;
}) {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [bpBusy, setBpBusy] = useState(false);
  const [look, setLook] = useState<LookPreview | null>(null);
  const [lookBusy, setLookBusy] = useState(false);
  const [open, setOpen] = useState<"blueprint" | "look" | null>(null);

  // Stage 1 — free, recomputed as they type (memo keeps it cheap).
  const lint = useMemo(() => (script.trim().split(/\s+/).length >= 30 ? lintScript(script) : null), [script]);

  const runBlueprint = useCallback(async () => {
    if (bpBusy) return;
    setBpBusy(true);
    try {
      const res = await fetch("/api/studio/blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, title, props }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setBp(d as Blueprint);
        setOpen("blueprint");
      } else addToast(d?.error ?? t("clips.renderFailed"), "error");
    } finally {
      setBpBusy(false);
    }
  }, [bpBusy, script, title, props, addToast, t]);

  const runLook = useCallback(async () => {
    if (lookBusy) return;
    setLookBusy(true);
    try {
      const res = await fetch("/api/studio/look-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, title, props, wide, storyCast: bp?.storyCast }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setLook(d as LookPreview);
        setOpen("look");
      } else addToast(d?.error ?? t("clips.renderFailed"), "error");
    } finally {
      setLookBusy(false);
    }
  }, [lookBusy, script, title, props, wide, bp, addToast, t]);

  if (!lint) return null;

  return (
    <div className="mt-3 rounded-xl border border-cyber-border bg-cyber-dark/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5 text-neon-purple" /> {t("desk.title")}
        </h4>
        <div className="flex gap-2">
          <button
            onClick={runBlueprint}
            disabled={bpBusy}
            className="px-3 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-[11px] text-electric-blue hover:border-electric-blue/50 disabled:opacity-50 flex items-center gap-1.5"
          >
            {bpBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
            {t("desk.blueprint")}
          </button>
          <button
            onClick={runLook}
            disabled={lookBusy}
            className="px-3 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-[11px] text-fuchsia-300 hover:border-fuchsia-500/50 disabled:opacity-50 flex items-center gap-1.5"
          >
            {lookBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Palette className="w-3 h-3" />}
            {t("desk.look")}
          </button>
        </div>
      </div>

      {/* The director's checklist — free, live. */}
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
        {lint.checklist.map((c) => (
          <p key={c.id} className={`text-[11px] flex items-center gap-1.5 ${c.ok ? "text-cyber-muted" : "text-warning"}`}>
            {c.ok ? <Check className="w-3 h-3 text-success shrink-0" /> : <X className="w-3 h-3 shrink-0" />}
            {c.note}
          </p>
        ))}
      </div>

      {/* Blueprint panel — who's in the film, in which lines, in whose voice. */}
      {open === "blueprint" && bp && (
        <div className="rounded-lg border border-cyber-border bg-cyber-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-foreground">{t("desk.bpTitle")}</p>
            <button onClick={() => setOpen(null)} className="text-cyber-muted hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {bp.storyCast.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-2">
              {bp.storyCast.map((c) => (
                <div key={c.name} className="rounded-lg bg-cyber-dark border border-cyber-border p-2">
                  <p className="text-[11px] font-semibold text-electric-blue">
                    {c.name}
                    {bp.voices[c.name.toUpperCase()] ? (
                      <span className="text-cyber-muted font-normal"> · {t("desk.voice")}: {bp.voices[c.name.toUpperCase()]}</span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-cyber-muted leading-snug">{c.design}</p>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bp.voices).map(([sp, v]) => (
              <span key={sp} className="px-2 py-0.5 rounded-full bg-cyber-dark border border-cyber-border text-[10px] text-cyber-muted">
                {sp} → {v ?? t("desk.narration")}
              </span>
            ))}
          </div>
          <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
            {bp.lint.lines.map((l, i) => (
              <p key={l.i} className="text-[10px] leading-snug text-cyber-muted">
                <span className={l.frame ? "text-amber-300/80" : "text-electric-blue/80"}>{l.speaker}</span>
                {bp.presence[i]?.length ? <span className="text-fuchsia-300/80"> [{bp.presence[i].join(", ")}]</span> : null}
                {l.cues.length ? <span className="text-success/80"> ({l.cues.join(",")})</span> : null}
                {l.climax ? <span className="text-warning"> ★</span> : null}
                {" "}
                {l.text.slice(0, 110)}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Look panel — real poster frames and real voices, before the draft. */}
      {open === "look" && look && (
        <div className="rounded-lg border border-cyber-border bg-cyber-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-foreground">{t("desk.lookTitle")}</p>
            <button onClick={() => setOpen(null)} className="text-cyber-muted hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className={`grid gap-2 ${wide ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-3"}`}>
            {look.posters.map((p, i) => (
              <figure key={i} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${p.b64}`}
                  alt=""
                  className={`w-full rounded-lg border border-cyber-border object-cover ${wide ? "aspect-video" : "aspect-[9/16]"}`}
                />
                <figcaption className="text-[10px] text-cyber-muted leading-snug line-clamp-2">{p.line}</figcaption>
              </figure>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {look.samples.map((s) => (
              <button
                key={s.speaker}
                onClick={() => {
                  new Audio(`data:audio/mpeg;base64,${s.b64}`).play().catch(() => {});
                }}
                className="px-2.5 py-1.5 rounded-lg bg-cyber-dark border border-cyber-border text-[11px] text-foreground hover:border-electric-blue/50 flex items-center gap-1.5"
              >
                <Volume2 className="w-3 h-3 text-electric-blue" /> {s.speaker}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-cyber-muted">{t("desk.lookHint")}</p>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Animation Studio as its own dashboard tab (Create group): one input — an
 * idea or a full script — plus a visual style, out comes a finished video.
 * Style presets carry art direction AND motion language; cartoon adds a
 * recurring-character sheet for scene-to-scene consistency. Renders queue
 * through the Clips tab, where the creator is sent after submitting.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { Check, Film, Loader2, Paperclip, Rocket, Sparkles, Trash2, UserRound } from "lucide-react";
import CharacterBuilder from "@/components/character-builder";
import SeriesTracker from "@/components/series-tracker";

interface Persona {
  id: string;
  name: string;
  source: string;
  ptype: string;
  voice?: string | null;
  charname?: string | null;
}

// Voice gender shown right in the picker, so a grandmother never ships with a
// baritone by accident.
const XAI_VOICES = [
  { id: "eve", label: "eve ♀" },
  { id: "luna", label: "luna ♀" },
  { id: "orion", label: "orion ♂" },
  { id: "perseus", label: "perseus ♂" },
  { id: "helix", label: "helix ♂" },
];

const PROP_TYPES = ["character", "product", "setting", "style", "archival"] as const;

export default function StudioTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [style, setStyle] = useState("cartoon");
  const [animate, setAnimate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [presPrompt, setPresPrompt] = useState("");
  const [presBusy, setPresBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [propSel, setPropSel] = useState<string[]>([]);
  const [propType, setPropType] = useState<string>("character");
  const fileRef = useRef<HTMLInputElement>(null);
  // Which panel the attach button belongs to: presenter upload or prop upload.
  const uploadTypeRef = useRef<string>("presenter");

  const loadPersonas = useCallback(() => {
    fetch("/api/personas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.personas) return;
        setPersonas(d.personas);
        setPersonaId(
          (cur) =>
            cur ||
            (d.personas as Persona[]).find((p) => p.ptype === "presenter" || p.ptype === "character")?.id ||
            ""
        );
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  const generatePersona = useCallback(
    async (ptype: string) => {
      if (presBusy || presPrompt.trim().length < 5) return;
      setPresBusy(true);
      try {
        const res = await fetch("/api/personas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: presPrompt.trim(), ptype }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok) {
          setPresPrompt("");
          if (ptype === "presenter") setPersonaId(d.persona.id);
          else setPropSel((cur) => [...cur.slice(0, 3), d.persona.id]);
          loadPersonas();
        } else addToast(d?.error ?? t("clips.renderFailed"), "error");
      } finally {
        setPresBusy(false);
      }
    },
    [presBusy, presPrompt, addToast, t, loadPersonas]
  );

  const uploadPersona = useCallback(
    async (file: File) => {
      if (presBusy) return;
      setPresBusy(true);
      const ptype = uploadTypeRef.current;
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("consent", "true");
        form.append("ptype", ptype);
        const res = await fetch("/api/personas", { method: "POST", body: form });
        const d = await res.json().catch(() => null);
        if (res.ok) {
          if (ptype === "presenter") setPersonaId(d.persona.id);
          else setPropSel((cur) => [...cur.slice(0, 3), d.persona.id]);
          loadPersonas();
        } else addToast(d?.error ?? t("clips.renderFailed"), "error");
      } finally {
        setPresBusy(false);
      }
    },
    [presBusy, addToast, t, loadPersonas]
  );

  const removePersona = useCallback(
    async (id: string) => {
      await fetch(`/api/personas/${id}`, { method: "DELETE" }).catch(() => {});
      setPersonaId((cur) => (cur === id ? "" : cur));
      setPropSel((cur) => cur.filter((x) => x !== id));
      loadPersonas();
    },
    [loadPersonas]
  );

  const presenters = personas.filter((p) => p.ptype === "presenter" || p.ptype === "character");
  const propItems = personas.filter((p) => p.ptype !== "presenter");

  const [labTitle, setLabTitle] = useState("");
  const [labBusy, setLabBusy] = useState(false);
  const [labThumbs, setLabThumbs] = useState<
    { id: string; variant: number; score: number | null; note: string; fix: string }[]
  >([]);
  const [labTitles, setLabTitles] = useState<{ t: string; score: number; len: number }[]>([]);
  const runThumbLab = useCallback(
    async (variant?: number, replaceId?: string) => {
      if (labBusy || labTitle.trim().length < 3) return;
      setLabBusy(true);
      try {
        const res = await fetch("/api/thumb-lab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: labTitle.trim(),
            personaId: personaId || undefined,
            ...(variant !== undefined ? { variant } : {}),
          }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.thumbs) {
          if (replaceId) {
            // Redo: the rejected variant is deleted and the fresh one slides in.
            fetch(`/api/images/${replaceId}`, { method: "DELETE" }).catch(() => {});
            setLabThumbs((cur) => cur.map((th) => (th.id === replaceId ? d.thumbs[0] : th)));
          } else {
            setLabThumbs(d.thumbs);
            setLabTitles(d.titles ?? []);
          }
        } else addToast(d?.error ?? t("clips.renderFailed"), "error");
      } finally {
        setLabBusy(false);
      }
    },
    [labBusy, labTitle, personaId, addToast, t]
  );
  const deleteThumb = useCallback(async (id: string) => {
    await fetch(`/api/images/${id}`, { method: "DELETE" }).catch(() => {});
    setLabThumbs((cur) => cur.filter((th) => th.id !== id));
  }, []);

  const [campBrief, setCampBrief] = useState("");
  const [campBusy, setCampBusy] = useState(false);
  const createCampaign = useCallback(async () => {
    if (campBusy || campBrief.trim().length < 30) return;
    setCampBusy(true);
    try {
      const res = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: campBrief.trim(),
          personaId: personaId || undefined,
          propIds: propSel,
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setCampBrief("");
        addToast(t("camp.queued"));
        onNavigate?.("Clips");
      } else {
        addToast(d?.error ?? t("clips.renderFailed"), "error");
      }
    } finally {
      setCampBusy(false);
    }
  }, [campBusy, campBrief, personaId, propSel, addToast, t, onNavigate]);

  const create = useCallback(async () => {
    if (busy || input.trim().length < 10) return;
    setBusy(true);
    try {
      const res = await fetch("/api/studio-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: input.trim(),
          style,
          animate: style === "ambient" ? false : animate,
          personaId: style === "ugc" ? personaId : undefined,
          propIds: style === "ambient" ? [] : propSel,
          locale: localStorage.getItem("ef_locale") || "en",
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setInput("");
        addToast(t("studio.queued"));
        onNavigate?.("Clips");
      } else {
        addToast(d?.error ?? t("clips.renderFailed"), "error");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, input, style, animate, personaId, propSel, addToast, t, onNavigate]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
          <Sparkles className="w-6 h-6 text-fuchsia-400" /> {t("studio.title")}
        </h1>
        <p className="text-sm text-cyber-muted mt-1">{t("studio.sub")}</p>
      </div>

      {/* The launch playbook as a live, self-checking stepper. */}
      <SeriesTracker
        onNavigate={onNavigate}
        onStep={(key) => {
          if (key === "cast") {
            document.getElementById("char-builder")?.scrollIntoView({ behavior: "smooth", block: "center" });
          } else if (key === "episode") {
            setStyle("cartoon");
            const el = document.getElementById("studio-script") as HTMLTextAreaElement | null;
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            el?.focus();
          } else if (key === "thumb") {
            const el = document.getElementById("thumb-lab-title") as HTMLInputElement | null;
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            el?.focus();
          }
        }}
      />

      <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 space-y-4">
        <textarea
          id="studio-script"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          placeholder={t("studio.placeholder")}
          className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 resize-y"
        />
        {/* 3D push-buttons: raised bevel at rest (hard bottom edge + top
            highlight), lifted on hover, physically pressed-in + glowing when
            selected — all in the brand purple/blue. */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 pb-1">
          {(["ugc", "cartoon", "explainer", "cinematic", "documentary", "ambient"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              aria-pressed={style === s}
              className={`px-3.5 py-3 rounded-xl text-left border transition-all duration-150 ${
                style === s
                  ? "translate-y-[3px] bg-gradient-to-b from-neon-purple/35 via-neon-purple/15 to-electric-blue/25 border-fuchsia-400/70 shadow-[inset_0_2px_8px_rgba(0,0,0,0.65),inset_0_-1px_0_rgba(255,255,255,0.06),0_0_22px_rgba(168,85,247,0.45)]"
                  : "bg-gradient-to-b from-[#241a3d] to-[#120c22] border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_5px_0_#07040f,0_10px_20px_rgba(0,0,0,0.55)] hover:-translate-y-0.5 hover:border-neon-purple/50 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_7px_0_#07040f,0_14px_26px_rgba(168,85,247,0.3)] active:translate-y-[3px] active:shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]"
              }`}
            >
              <span
                className={`block text-xs font-semibold tracking-wide ${
                  style === s ? "text-fuchsia-300 drop-shadow-[0_0_6px_rgba(217,70,239,0.6)]" : "text-foreground"
                }`}
              >
                {t(`studio.s.${s}`)}
              </span>
              <span className="block text-[11px] text-cyber-muted mt-1 leading-snug">{t(`studio.d.${s}`)}</span>
            </button>
          ))}
        </div>
        {/* UGC presenter panel: pick a saved persona, generate one from a
            description, or attach a photo (with a recorded rights attestation
            — animate-a-photo is deepfake-adjacent, so consent is explicit). */}
        {style === "ugc" && (
          <div className="bg-cyber-dark/60 border border-cyber-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <UserRound className="w-3.5 h-3.5 text-fuchsia-400" /> {t("studio.presenter")}
            </p>
            {presenters.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {presenters.map((p) => (
                  <div key={p.id} className="relative group">
                    <button
                      onClick={() => setPersonaId(p.id)}
                      title={p.name}
                      className={`block w-16 h-24 rounded-lg overflow-hidden border-2 transition-colors ${
                        personaId === p.id
                          ? "border-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.4)]"
                          : "border-cyber-border hover:border-neon-purple/50"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/personas/${p.id}`} alt={p.name} className="w-full h-full object-cover" />
                    </button>
                    <button
                      onClick={() => removePersona(p.id)}
                      aria-label={t("inbox.dismiss")}
                      className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-5 h-5 items-center justify-center rounded-full bg-cyber-card border border-cyber-border text-cyber-muted hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={presPrompt}
                onChange={(e) => setPresPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generatePersona("presenter")}
                placeholder={t("studio.presenterGenPh")}
                className="flex-1 min-w-[200px] px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
              />
              <button
                onClick={() => generatePersona("presenter")}
                disabled={presBusy || presPrompt.trim().length < 5}
                className="px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {presBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {t("studio.presenterGen")}
              </button>
              <button
                onClick={() => {
                  uploadTypeRef.current = "presenter";
                  if (consent) fileRef.current?.click();
                }}
                disabled={presBusy || !consent}
                title={consent ? undefined : t("studio.consent")}
                className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs font-medium text-foreground hover:border-neon-purple/50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Paperclip className="w-3.5 h-3.5" /> {t("studio.presenterAttach")}
              </button>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-fuchsia-500"
              />
              <span className="text-[11px] text-cyber-muted leading-snug">{t("studio.consent")}</span>
            </label>
            <p className="text-[11px] text-cyber-muted leading-snug">{t("studio.presenterNote")}</p>
          </div>
        )}

        {/* Shared hidden file input — presenter and prop uploads both use it;
            uploadTypeRef says which panel asked. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadPersona(f);
            e.target.value = "";
          }}
        />

        {/* Props library: characters, products, settings, and style references
            that every scene must honor — pick up to 4. */}
        {style !== "ambient" && (
          <div className="bg-cyber-dark/60 border border-cyber-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-electric-blue" /> {t("studio.props")}
            </p>
            <p className="text-[11px] text-cyber-muted leading-snug">{t("studio.propsHint")}</p>
            {propItems.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {propItems.map((p) => (
                  <div key={p.id} className="relative group">
                    <button
                      onClick={() =>
                        setPropSel((cur) =>
                          cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur.slice(0, 3), p.id]
                        )
                      }
                      title={p.name}
                      className={`block w-16 h-24 rounded-lg overflow-hidden border-2 transition-colors ${
                        propSel.includes(p.id)
                          ? "border-electric-blue shadow-[0_0_12px_rgba(59,130,246,0.4)]"
                          : "border-cyber-border hover:border-neon-purple/50"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/personas/${p.id}`} alt={p.name} className="w-full h-full object-cover" />
                    </button>
                    <span className="absolute bottom-0 inset-x-0 text-center text-[9px] bg-black/70 text-cyber-muted px-0.5 truncate rounded-b-md pointer-events-none">
                      {t(`studio.pt.${p.ptype}`)}
                    </span>
                    <button
                      onClick={() => removePersona(p.id)}
                      aria-label={t("inbox.dismiss")}
                      className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-5 h-5 items-center justify-center rounded-full bg-cyber-card border border-cyber-border text-cyber-muted hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    {(p.ptype === "character" || p.ptype === "presenter") && (
                      <>
                        <input
                          type="text"
                          defaultValue={p.charname ?? ""}
                          placeholder={t("studio.scriptNamePh")}
                          title={t("studio.scriptNameTitle")}
                          maxLength={25}
                          onBlur={async (e) => {
                            const v = e.target.value.trim().toUpperCase();
                            if (v === (p.charname ?? "")) return;
                            await fetch(`/api/personas/${p.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ charname: v }),
                            }).catch(() => {});
                            loadPersonas();
                          }}
                          className="mt-1 w-16 px-1 py-0.5 bg-cyber-dark border border-cyber-border rounded text-[9px] text-foreground uppercase placeholder:normal-case focus:outline-none focus:border-neon-purple/50"
                        />
                        <select
                          value={p.voice ?? ""}
                          title={t("studio.voiceTitle")}
                          onChange={async (e) => {
                            await fetch(`/api/personas/${p.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ voice: e.target.value }),
                            }).catch(() => {});
                            loadPersonas();
                          }}
                          className="mt-1 w-16 px-1 py-0.5 bg-cyber-dark border border-cyber-border rounded text-[9px] text-cyber-muted focus:outline-none focus:border-neon-purple/50"
                        >
                          <option value="">{t("studio.voiceAuto")}</option>
                          {XAI_VOICES.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-cyber-muted leading-snug">{t("studio.screenplayHint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={propType}
                onChange={(e) => setPropType(e.target.value)}
                className="px-2.5 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
              >
                {PROP_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {t(`studio.pt.${pt}`)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={presPrompt}
                onChange={(e) => setPresPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generatePersona(propType)}
                placeholder={t("studio.propPh")}
                className="flex-1 min-w-[180px] px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
              />
              <button
                onClick={() => generatePersona(propType)}
                disabled={presBusy || presPrompt.trim().length < 5}
                className="px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {presBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {t("studio.presenterGen")}
              </button>
              <button
                onClick={() => {
                  uploadTypeRef.current = propType;
                  if (consent) fileRef.current?.click();
                }}
                disabled={presBusy || !consent}
                title={consent ? undefined : t("studio.consent")}
                className="px-3 py-2 rounded-lg bg-cyber-dark border border-cyber-border text-xs font-medium text-foreground hover:border-neon-purple/50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Paperclip className="w-3.5 h-3.5" /> {t("studio.presenterAttach")}
              </button>
            </div>
            {style !== "ugc" && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 accent-fuchsia-500"
                />
                <span className="text-[11px] text-cyber-muted leading-snug">{t("studio.consent")}</span>
              </label>
            )}
            {/* The deliberate path: three candidates, refine, explicit Accept. */}
            <div id="char-builder">
              <CharacterBuilder onAccepted={() => loadPersonas()} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {style !== "ambient" ? (
            <button
              onClick={() => setAnimate((v) => !v)}
              aria-pressed={animate}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                animate
                  ? "bg-fuchsia-500/20 border-fuchsia-500/60 text-fuchsia-300 shadow-[0_0_12px_rgba(217,70,239,0.25)]"
                  : "bg-cyber-dark border-cyber-border text-cyber-muted hover:text-foreground hover:border-fuchsia-500/40"
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              {t("studio.motion")}
              {animate && <Check className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="text-xs text-cyber-muted">{t("studio.ambientNote")}</span>
          )}
          <button
            onClick={create}
            disabled={busy || input.trim().length < 10 || (style === "ugc" && !personaId)}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
            {t("studio.create")}
          </button>
        </div>
      </div>

      {/* Campaign pack: one brief → UGC ad + explainer + cinematic teaser,
          sharing the selected presenter and props. Honest writer: scripts can
          only claim what the brief itself says. */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 space-y-3">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Rocket className="w-4 h-4 text-electric-blue" /> {t("camp.title")}
        </p>
        <p className="text-xs text-cyber-muted">{t("camp.hint")}</p>
        <textarea
          value={campBrief}
          onChange={(e) => setCampBrief(e.target.value)}
          rows={3}
          placeholder={t("camp.briefPh")}
          className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 resize-y"
        />
        <div className="flex justify-end">
          <button
            onClick={createCampaign}
            disabled={campBusy || campBrief.trim().length < 30}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {campBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            {t("camp.create")}
          </button>
        </div>
      </div>

      {/* Thumbnail Lab: three CTR-fundamentals variants, vision-scored.
          Scores are heuristics — the thumbnail A/B test on published posts
          is where real views decide. */}
      <div className="bg-cyber-card border border-cyber-border rounded-xl p-5 space-y-3">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-warning" /> {t("lab.title")}
        </p>
        <p className="text-xs text-cyber-muted">{t("lab.hint")}</p>
        <div className="flex flex-wrap gap-2">
          <input
            id="thumb-lab-title"
            type="text"
            value={labTitle}
            onChange={(e) => setLabTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runThumbLab()}
            placeholder={t("lab.titlePh")}
            autoComplete="off"
            className="flex-1 min-w-[220px] px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
          />
          <button
            onClick={() => runThumbLab()}
            disabled={labBusy || labTitle.trim().length < 3}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {labBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {t("lab.run")}
          </button>
        </div>
        {labTitles.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">{t("lab.titles")}</p>
            {labTitles.map((ti) => (
              <div
                key={ti.t}
                className="flex items-center gap-2 bg-cyber-dark border border-cyber-border rounded-lg px-3 py-2"
              >
                <span
                  className={`text-xs font-bold shrink-0 ${ti.score >= 70 ? "text-success" : ti.score >= 45 ? "text-warning" : "text-red-400"}`}
                >
                  {ti.score}
                </span>
                <span className="text-xs text-foreground flex-1 min-w-0">{ti.t}</span>
                <span className={`text-[10px] shrink-0 ${ti.len > 60 ? "text-red-400" : "text-cyber-muted"}`}>
                  {ti.len}ch
                </span>
                <button
                  onClick={() => {
                    setLabTitle(ti.t);
                    navigator.clipboard?.writeText(ti.t).catch(() => {});
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-cyber-card border border-cyber-border text-neon-purple hover:border-neon-purple/50 shrink-0"
                >
                  {t("share.copy")}
                </button>
              </div>
            ))}
          </div>
        )}
        {labThumbs.length > 0 && (
          <div className="grid sm:grid-cols-3 gap-3">
            {labThumbs.map((th) => (
              <div key={th.id} className="space-y-1.5">
                <a href={`/api/images/${th.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/images/${th.id}`}
                    alt=""
                    className="w-full rounded-lg border border-cyber-border hover:border-neon-purple/50"
                  />
                </a>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => runThumbLab(th.variant, th.id)}
                    disabled={labBusy}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-cyber-dark border border-cyber-border text-[11px] font-medium text-foreground hover:border-neon-purple/50 disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {labBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {t("lab.redo")}
                  </button>
                  <button
                    onClick={() => deleteThumb(th.id)}
                    aria-label={t("inbox.dismiss")}
                    className="px-2 py-1.5 rounded-lg bg-cyber-dark border border-cyber-border text-cyber-muted hover:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {th.score !== null && (
                  <p className="text-xs text-foreground">
                    <span className={`font-bold ${th.score >= 70 ? "text-success" : th.score >= 45 ? "text-warning" : "text-red-400"}`}>
                      {th.score}
                    </span>
                    <span className="text-cyber-muted"> / 100 · {th.note}</span>
                  </p>
                )}
                {th.fix && <p className="text-[11px] text-cyber-muted">↳ {th.fix}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

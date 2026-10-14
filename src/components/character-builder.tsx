"use client";

/**
 * Character Builder: name it, describe it, get THREE candidates, refine any of
 * them ("same character, but older"), and explicitly Accept the one that
 * becomes canon. New characters are prompted to look clearly distinct from the
 * existing cast, and nothing enters the props library without an Accept.
 */

import { useCallback, useState } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles, Wand2 } from "lucide-react";

const TYPES = ["character", "presenter", "product", "setting", "style", "archival"] as const;

export default function CharacterBuilder({ onAccepted }: { onAccepted: (ptype: string) => void }) {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [ptype, setPtype] = useState<string>("character");
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [refineFor, setRefineFor] = useState<string | null>(null);
  const [refineText, setRefineText] = useState("");
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const generate = useCallback(
    async (refineImageId?: string) => {
      if (busy) return;
      if (!refineImageId && desc.trim().length < 5) return;
      setBusy(true);
      try {
        const res = await fetch("/api/personas/candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            refineImageId
              ? { ptype, refineImageId, instruction: refineText.trim() }
              : { ptype, prompt: desc.trim() }
          ),
        });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.candidates?.length) {
          setCandidates(d.candidates);
          setRefineFor(null);
          setRefineText("");
        } else addToast(d?.error ?? t("clips.renderFailed"), "error");
      } finally {
        setBusy(false);
      }
    },
    [busy, desc, ptype, refineText, addToast, t]
  );

  const accept = useCallback(
    async (imageId: string) => {
      if (acceptingId) return;
      if (name.trim().length < 1) {
        addToast(t("cb.needName"), "error");
        return;
      }
      setAcceptingId(imageId);
      try {
        const res = await fetch("/api/personas/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId, name: name.trim(), ptype }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok) {
          addToast(t("cb.accepted").replace("{name}", name.trim()));
          setCandidates([]);
          setName("");
          setDesc("");
          onAccepted(ptype);
        } else addToast(d?.error ?? t("clips.renderFailed"), "error");
      } finally {
        setAcceptingId(null);
      }
    },
    [acceptingId, name, ptype, addToast, t, onAccepted]
  );

  return (
    <div className="border border-cyber-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-cyber-dark/60 text-left"
      >
        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5 text-fuchsia-400" /> {t("cb.title")}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-cyber-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-cyber-muted" />
        )}
      </button>
      {open && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-cyber-muted leading-snug">{t("cb.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("cb.namePh")}
              className="w-36 px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
            />
            <select
              value={ptype}
              onChange={(e) => setPtype(e.target.value)}
              className="px-2.5 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
            >
              {TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {t(`studio.pt.${pt}`)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generate()}
              placeholder={t("studio.propPh")}
              className="flex-1 min-w-[180px] px-3 py-2 bg-cyber-dark border border-cyber-border rounded-lg text-xs text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
            />
            <button
              onClick={() => generate()}
              disabled={busy || desc.trim().length < 5}
              className="px-3 py-2 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {t("cb.gen")}
            </button>
          </div>

          {candidates.length > 0 && (
            <div className="grid sm:grid-cols-3 gap-3">
              {candidates.map((id) => (
                <div key={id} className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/images/${id}`}
                    alt=""
                    className="w-full rounded-lg border border-cyber-border aspect-[9/16] object-cover"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => accept(id)}
                      disabled={acceptingId !== null}
                      className="flex-1 px-2 py-1.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-[11px] font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {acceptingId === id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      {t("cb.accept")}
                    </button>
                    <button
                      onClick={() => setRefineFor(refineFor === id ? null : id)}
                      className="px-2 py-1.5 rounded-lg bg-cyber-dark border border-cyber-border text-[11px] text-cyber-muted hover:text-foreground"
                    >
                      {t("cb.refine")}
                    </button>
                  </div>
                  {refineFor === id && (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && refineText.trim().length >= 3 && generate(id)}
                        placeholder={t("cb.refinePh")}
                        className="flex-1 min-w-0 px-2 py-1.5 bg-cyber-dark border border-cyber-border rounded-lg text-[11px] text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
                      />
                      <button
                        onClick={() => generate(id)}
                        disabled={busy || refineText.trim().length < 3}
                        className="px-2 py-1.5 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/50 text-fuchsia-300 text-[11px] font-semibold disabled:opacity-50"
                      >
                        {busy ? "…" : "→"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

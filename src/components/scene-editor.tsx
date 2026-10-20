"use client";

/**
 * Scene editor: a filmstrip of the video's persisted build plan. Each scene
 * can be edited by prompt (image-to-image on its current still), re-rolled
 * from its stored prompt, or replaced with an uploaded image — one segment
 * rebuilds and splices back in seconds. Audio and timing are never touched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { Film, Loader2, Paperclip, RefreshCw, Trash2, Wand2, X } from "lucide-react";

interface Beat {
  i: number;
  text: string;
  start: number;
  dur: number;
  kind: string;
  file: string;
  image: boolean;
  /** Reference image for the filmstrip — the still itself, the source still a
   *  video beat was generated from, or a frame extracted from the video. */
  preview?: string | null;
}

export default function SceneEditor({
  clipId,
  onClose,
  onEdited,
}: {
  clipId: string;
  onClose: () => void;
  onEdited: () => void;
}) {
  const { addToast } = useApp();
  const { t } = useTranslation();
  const [beats, setBeats] = useState<Beat[] | null>(null);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [promptFor, setPromptFor] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [bust, setBust] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadIdx = useRef<number>(-1);

  const load = useCallback(() => {
    fetch(`/api/clips/${clipId}/plan`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.beats) setBeats(d.beats);
        if (d) setWide(Boolean(d.wide));
      })
      .catch(() => {});
  }, [clipId]);
  useEffect(() => {
    load();
  }, [load]);

  const applyEdit = useCallback(
    async (index: number, body: FormData | { index: number; mode: string; instruction?: string }) => {
      if (busy !== null) return;
      setBusy(index);
      try {
        const res = await fetch(`/api/clips/${clipId}/edit-beat`, {
          method: "POST",
          ...(body instanceof FormData
            ? { body }
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok) {
          addToast(t("ed.applied"));
          setPromptFor(null);
          setInstruction("");
          setBust((v) => v + 1);
          load();
          onEdited();
        } else addToast(d?.error ?? t("clips.renderFailed"), "error");
      } finally {
        setBusy(null);
      }
    },
    [busy, clipId, addToast, t, load, onEdited]
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Film className="w-4 h-4 text-neon-purple" /> {t("ed.title")}
          </h2>
          <button onClick={onClose} aria-label={t("inbox.dismiss")} className="text-cyber-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="px-6 pt-3 text-xs text-cyber-muted">{t("ed.hint")}</p>
        <div className="p-6 overflow-y-auto">
          {!beats ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-neon-purple" />
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {beats.map((b) => (
                <div key={b.i} className="bg-cyber-dark border border-cyber-border rounded-xl p-2.5 space-y-2">
                  {b.preview || b.image ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/clips/${clipId}/plan?asset=${encodeURIComponent(b.preview ?? b.file)}&v=${bust}`}
                        alt=""
                        className={`w-full rounded-lg ${wide ? "aspect-video" : "aspect-[9/16]"} object-cover border border-cyber-border`}
                      />
                      {!b.image && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/70 p-0.5 text-cyber-muted">
                          <Film className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`w-full rounded-lg ${wide ? "aspect-video" : "aspect-[9/16]"} border border-cyber-border flex items-center justify-center text-cyber-muted`}
                    >
                      <Film className="w-6 h-6" />
                    </div>
                  )}
                  <p className="text-[10px] text-cyber-muted">
                    #{b.i + 1} · {Math.round(b.start)}s · {b.dur.toFixed(1)}s
                  </p>
                  <p className="text-[11px] text-foreground/90 line-clamp-2">{b.text}</p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPromptFor(promptFor === b.i ? null : b.i)}
                      disabled={busy !== null}
                      title={t("ed.prompt")}
                      className="flex-1 px-1.5 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-fuchsia-300 hover:border-fuchsia-500/50 disabled:opacity-50 flex items-center justify-center"
                    >
                      {busy === b.i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => applyEdit(b.i, { index: b.i, mode: "reroll" })}
                      disabled={busy !== null}
                      title={t("ed.reroll")}
                      className="flex-1 px-1.5 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-cyber-muted hover:text-foreground disabled:opacity-50 flex items-center justify-center"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        uploadIdx.current = b.i;
                        fileRef.current?.click();
                      }}
                      disabled={busy !== null}
                      title={t("ed.upload")}
                      className="flex-1 px-1.5 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-cyber-muted hover:text-foreground disabled:opacity-50 flex items-center justify-center"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(t("ed.deleteConfirm"))) {
                          applyEdit(b.i, { index: b.i, mode: "delete" });
                        }
                      }}
                      disabled={busy !== null || beats.length <= 3}
                      title={t("ed.delete")}
                      className="flex-1 px-1.5 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-cyber-muted hover:text-red-400 hover:border-red-500/50 disabled:opacity-50 flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {promptFor === b.i && (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" &&
                          instruction.trim().length >= 3 &&
                          applyEdit(b.i, { index: b.i, mode: "prompt", instruction: instruction.trim() })
                        }
                        placeholder={t("ed.promptPh")}
                        autoFocus
                        className="flex-1 min-w-0 px-2 py-1.5 bg-cyber-card border border-fuchsia-500/50 rounded-lg text-[11px] text-foreground focus:outline-none"
                      />
                      <button
                        onClick={() => applyEdit(b.i, { index: b.i, mode: "prompt", instruction: instruction.trim() })}
                        disabled={busy !== null || instruction.trim().length < 3}
                        className="px-2 py-1.5 rounded-lg bg-gradient-to-r from-neon-purple to-electric-blue text-white text-[11px] font-semibold disabled:opacity-50"
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && uploadIdx.current >= 0) {
              const form = new FormData();
              form.append("index", String(uploadIdx.current));
              form.append("file", f);
              applyEdit(uploadIdx.current, form);
            }
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

"use client";

/**
 * Editing tab: the post-production floor. Every rendered film that has an
 * edit plan, as a card — click one and its Cutting Room opens: player,
 * filmstrip, mixer, grades, camera paths, takes, notes. Films without plans
 * (old renders, ambient loops) don't appear; they have nothing to edit.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import CuttingRoom from "@/components/cutting-room";
import { Clock, Loader2, Scissors } from "lucide-react";

interface EditableClip {
  id: string;
  title: string;
  status: string;
  kind: string;
  hasPlan?: number;
  thumbPath?: string | null;
  lang?: string | null;
  createdAt?: string;
}

export default function EditingTab() {
  const { t } = useTranslation();
  const [clips, setClips] = useState<EditableClip[] | null>(null);
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/clips", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.clips) return;
        setClips(
          (d.clips as EditableClip[]).filter(
            (c) => c.status === "ready" && Boolean(c.hasPlan)
          )
        );
      })
      .catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Scissors className="w-5 h-5 text-neon-purple" /> {t("edit.title")}
        </h2>
        <p className="text-xs text-cyber-muted mt-1">{t("edit.hint")}</p>
      </div>

      {!clips ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-neon-purple" />
        </div>
      ) : clips.length === 0 ? (
        <div className="bg-cyber-card border border-cyber-border rounded-xl p-8 text-center">
          <p className="text-sm text-cyber-muted">{t("edit.empty")}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clips.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpen({ id: c.id, title: c.title })}
              className="group text-left bg-cyber-card border border-cyber-border rounded-xl overflow-hidden hover:border-neon-purple/60 transition-colors"
            >
              <div className="aspect-video bg-cyber-dark relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/clips/${c.id}/thumb`}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                  <span className="px-3 py-1.5 rounded-lg bg-neon-purple text-white text-xs font-semibold flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5" /> {t("cut.open")}
                  </span>
                </span>
              </div>
              <div className="p-3">
                <p className="text-xs font-medium text-foreground line-clamp-2">{c.title}</p>
                <p className="text-[10px] text-cyber-muted mt-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {(c.lang || "en").toUpperCase()}
                  {c.createdAt ? ` · ${new Date(c.createdAt).toLocaleDateString()}` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <CuttingRoom
          clipId={open.id}
          title={open.title}
          onClose={() => setOpen(null)}
          onEdited={load}
        />
      )}
    </div>
  );
}

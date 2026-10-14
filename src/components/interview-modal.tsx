"use client";

/**
 * "Talk it out": an AI interviewer asks a few sharp questions; the creator
 * answers out loud. Answers are transcribed server-side and the compiled Q&A
 * becomes the source transcript for a normal project — the whole repurposing
 * pipeline downstream of a conversation instead of a blank page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { Check, Loader2, Mic, Square, X } from "lucide-react";

type Stage = "topic" | "asking" | "review";

export default function InterviewModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { uploadProject, addToast } = useApp();
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("topic");
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const reset = useCallback(() => {
    setStage("topic");
    setTopic("");
    setQuestion("");
    setQa([]);
    setRecording(false);
    setBusy(false);
    try {
      recRef.current?.stream.getTracks().forEach((tr) => tr.stop());
    } catch {}
    recRef.current = null;
  }, []);
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const fetchQuestion = useCallback(
    async (history: { q: string; a: string }[]) => {
      setBusy(true);
      try {
        const res = await fetch("/api/interview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: topic.trim(), qa: history }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.question && !d.done) {
          setQuestion(d.question);
          setStage("asking");
        } else {
          setStage(history.length > 0 ? "review" : "topic");
          if (!res.ok) addToast(d?.error ?? t("intv.failed"), "error");
        }
      } finally {
        setBusy(false);
      }
    },
    [topic, addToast, t]
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        setBusy(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "answer.webm");
          const res = await fetch("/api/interview", { method: "POST", body: form });
          const d = await res.json().catch(() => null);
          if (res.ok && d?.text) {
            const history = [...qa, { q: question, a: d.text }];
            setQa(history);
            if (history.length >= 6) setStage("review");
            else await fetchQuestion(history);
          } else {
            addToast(d?.error ?? t("intv.failed"), "error");
            setBusy(false);
          }
        } finally {
          setBusy(false);
        }
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      addToast(t("intv.micDenied"), "error");
    }
  }, [qa, question, fetchQuestion, addToast, t]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    try {
      recRef.current?.stop();
    } catch {}
  }, []);

  const finish = useCallback(async () => {
    if (busy || qa.length === 0) return;
    setBusy(true);
    try {
      const transcript = qa.map((x) => `Interviewer: ${x.q}\n\nMe: ${x.a}`).join("\n\n");
      const project = await uploadProject(null, transcript, undefined, topic.trim().slice(0, 100));
      if (project) {
        addToast(t("intv.created"));
        onClose();
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, qa, topic, uploadProject, addToast, t, onClose, onDone]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-lg p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Mic className="w-5 h-5 text-neon-purple" /> {t("intv.title")}
          </h2>
          <button onClick={onClose} aria-label={t("inbox.dismiss")} className="text-cyber-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {stage === "topic" && (
          <>
            <p className="text-sm text-cyber-muted">{t("intv.sub")}</p>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && topic.trim().length >= 3 && fetchQuestion([])}
              placeholder={t("intv.topicPh")}
              className="w-full px-3 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
            />
            <button
              onClick={() => fetchQuestion([])}
              disabled={busy || topic.trim().length < 3}
              className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
              {t("intv.start")}
            </button>
          </>
        )}

        {stage === "asking" && (
          <>
            <p className="text-xs text-cyber-muted">
              {t("intv.progress").replace("{n}", String(qa.length + 1))}
            </p>
            <p className="text-base text-foreground font-medium leading-relaxed">{question}</p>
            <div className="flex items-center justify-center py-4">
              {busy ? (
                <div className="flex items-center gap-2 text-sm text-cyber-muted">
                  <Loader2 className="w-5 h-5 animate-spin text-neon-purple" /> {t("intv.transcribing")}
                </div>
              ) : recording ? (
                <button
                  onClick={stopRecording}
                  className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-400 flex items-center justify-center animate-pulse"
                  aria-label={t("intv.stop")}
                >
                  <Square className="w-7 h-7 text-red-400" />
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  className="w-20 h-20 rounded-full bg-neon-purple/20 border-2 border-neon-purple flex items-center justify-center hover:bg-neon-purple/30"
                  aria-label={t("intv.record")}
                >
                  <Mic className="w-7 h-7 text-neon-purple" />
                </button>
              )}
            </div>
            <p className="text-center text-xs text-cyber-muted">
              {recording ? t("intv.stopHint") : t("intv.recordHint")}
            </p>
            {qa.length >= 3 && !recording && !busy && (
              <button onClick={() => setStage("review")} className="w-full text-xs text-neon-purple hover:underline">
                {t("intv.enough")}
              </button>
            )}
          </>
        )}

        {stage === "review" && (
          <>
            <p className="text-sm text-cyber-muted">{t("intv.reviewSub").replace("{n}", String(qa.length))}</p>
            <div className="max-h-48 overflow-y-auto space-y-2 bg-cyber-dark border border-cyber-border rounded-xl p-3">
              {qa.map((x, i) => (
                <div key={i}>
                  <p className="text-xs text-neon-purple">{x.q}</p>
                  <p className="text-xs text-foreground/90 mt-0.5">{x.a}</p>
                </div>
              ))}
            </div>
            <button
              onClick={finish}
              disabled={busy}
              className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {t("intv.finish")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

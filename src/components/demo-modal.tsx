"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Brain,
  Scissors,
  Palette,
  CheckCircle,
  Rocket,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowRight,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

// Slow enough to actually read a title + two sentences before the step turns.
const STEP_MS = 7000;
const TICK_MS = 40;

const STEPS = [
  { icon: Upload, titleKey: "hiw.step1Title", descKey: "hiw.step1Desc", detail: "MP4, MOV, MP3, WAV" },
  { icon: Brain, titleKey: "hiw.step2Title", descKey: "hiw.step2Desc", detail: "AI content scoring & hook detection" },
  { icon: Scissors, titleKey: "hiw.step3Title", descKey: "hiw.step3Desc", detail: "Retention-optimized cuts" },
  { icon: Palette, titleKey: "hiw.step4Title", descKey: "hiw.step4Desc", detail: "Captions, AI voiceover & thumbnails" },
  { icon: CheckCircle, titleKey: "hiw.step5Title", descKey: "hiw.step5Desc", detail: "You approve — nothing ships without you" },
  { icon: Rocket, titleKey: "hiw.step6Title", descKey: "hiw.step6Desc", detail: "TikTok, YouTube, LinkedIn, X" },
];

export default function DemoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [prevOpen, setPrevOpen] = useState(open);

  const finished = index === STEPS.length - 1 && progress >= 100;

  // Reset when the modal transitions to open — done during render (React's
  // recommended pattern) rather than in an effect, to avoid cascading renders.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setIndex(0);
      setProgress(0);
      setPlaying(true);
    }
  }

  // Auto-advance playhead.
  useEffect(() => {
    if (!open || !playing) return;
    const timer = setInterval(() => {
      setProgress((p) => {
        const next = p + (100 * TICK_MS) / STEP_MS;
        if (next >= 100) {
          setIndex((i) => {
            if (i < STEPS.length - 1) return i + 1;
            setPlaying(false);
            return i;
          });
          return index < STEPS.length - 1 ? 0 : 100;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [open, playing, index]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const goTo = useCallback((i: number) => {
    setIndex(Math.max(0, Math.min(STEPS.length - 1, i)));
    setProgress(0);
  }, []);

  const togglePlay = useCallback(() => {
    if (finished) {
      setIndex(0);
      setProgress(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  }, [finished]);

  const step = STEPS[index];
  const Icon = step.icon;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-cyber-card border border-cyber-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl shadow-black/40"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-neon-purple to-electric-blue flex items-center justify-center">
                  <Play className="w-3.5 h-3.5 text-white" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{t("hero.cta2")}</h3>
              </div>
              <button
                onClick={onClose}
                className="text-cyber-muted hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* "Screen" */}
            <div className="relative aspect-video bg-gradient-to-br from-cyber-dark via-background to-cyber-dark overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full bg-gradient-to-b from-transparent via-neon-purple/20 to-transparent" />
              <AnimatePresence mode="wait">
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.35 }}
                  className="absolute inset-0 flex flex-col items-center justify-center text-center px-8"
                >
                  <div className="relative mb-5">
                    <motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      className="w-20 h-20 rounded-3xl bg-gradient-to-br from-neon-purple to-electric-blue flex items-center justify-center"
                    >
                      <Icon className="w-9 h-9 text-white" />
                    </motion.div>
                    <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-background border-2 border-neon-purple flex items-center justify-center text-xs font-bold text-neon-purple">
                      {index + 1}
                    </div>
                  </div>
                  <h4 className="text-xl font-bold text-foreground mb-2">{t(step.titleKey)}</h4>
                  <p className="text-sm text-cyber-muted max-w-md mb-3">{t(step.descKey)}</p>
                  <p className="text-xs text-neon-purple/70 font-mono">{step.detail}</p>
                </motion.div>
              </AnimatePresence>

              <div className="absolute bottom-3 right-4 text-[11px] font-mono text-cyber-muted">
                {index + 1} / {STEPS.length}
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-cyber-border">
              <div
                className="h-full bg-gradient-to-r from-neon-purple to-electric-blue"
                style={{ width: `${progress}%`, transition: `width ${TICK_MS}ms linear` }}
              />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 px-6 py-4">
              <button
                onClick={togglePlay}
                className="w-9 h-9 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white flex items-center justify-center hover:opacity-90 transition-opacity shrink-0"
                aria-label={finished ? "Replay" : playing ? "Pause" : "Play"}
              >
                {finished ? (
                  <RotateCcw className="w-4 h-4" />
                ) : playing ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                className="text-cyber-muted hover:text-foreground disabled:opacity-30 transition-colors"
                aria-label="Previous step"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              {/* Step dots */}
              <div className="flex-1 flex items-center justify-center gap-2">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    aria-label={`Step ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? "w-6 bg-neon-purple" : "w-1.5 bg-cyber-border hover:bg-cyber-muted"
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={() => goTo(index + 1)}
                disabled={index === STEPS.length - 1}
                className="text-cyber-muted hover:text-foreground disabled:opacity-30 transition-colors"
                aria-label="Next step"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* CTA footer */}
            <div className="px-6 pb-6">
              <Link
                href="/signup"
                onClick={onClose}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {t("hero.cta1")} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  Brain,
  Scissors,
  Palette,
  CheckCircle,
  Play,
  Rocket,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

// The walkthrough lives on the @Virafold channel — playing it here counts
// as a real YouTube view. Click-to-load keeps the page fast and cookie-free
// until the visitor actually presses play.
const WALKTHROUGH_YT_ID = "A2N2p_vGQRY";

export default function HowItWorks() {
  const { t } = useTranslation();
  const [videoPlaying, setVideoPlaying] = useState(false);

  const steps = [
    {
      icon: Upload,
      title: t("hiw.step1Title"),
      description: t("hiw.step1Desc"),
      detail: t("hiw.detail1"),
    },
    {
      icon: Brain,
      title: t("hiw.step2Title"),
      description: t("hiw.step2Desc"),
      detail: t("hiw.detail2"),
    },
    {
      icon: Scissors,
      title: t("hiw.step3Title"),
      description: t("hiw.step3Desc"),
      detail: t("hiw.detail3"),
    },
    {
      icon: Palette,
      title: t("hiw.step4Title"),
      description: t("hiw.step4Desc"),
      detail: t("hiw.detail4"),
    },
    {
      icon: CheckCircle,
      title: t("hiw.step5Title"),
      description: t("hiw.step5Desc"),
      detail: t("hiw.detail5"),
    },
    {
      icon: Rocket,
      title: t("hiw.step6Title"),
      description: t("hiw.step6Desc"),
      detail: t("hiw.detail6"),
    },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-cyber-dark relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full bg-gradient-to-b from-transparent via-neon-purple/20 to-transparent" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            {t("hiw.title1")} <span className="gradient-text">{t("hiw.title2")}</span>
          </h2>
          <p className="text-cyber-muted max-w-xl mx-auto">
            {t("hiw.description")}
          </p>
        </motion.div>

        {/* The full product walkthrough — real UI, narrated, 4 minutes. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-20"
        >
          <div className="rounded-2xl overflow-hidden border border-neon-purple/30 shadow-[0_0_60px_-15px_rgba(168,85,247,0.4)] aspect-video bg-cyber-dark">
            {videoPlaying ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${WALKTHROUGH_YT_ID}?autoplay=1&rel=0`}
                title="Virafold walkthrough"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            ) : (
              <button
                onClick={() => setVideoPlaying(true)}
                className="relative w-full h-full group"
                aria-label="Play walkthrough video"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/media/walkthrough-poster.jpg"
                  alt=""
                  className="w-full h-full object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/10 transition-colors">
                  <span className="w-20 h-20 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                    <Play className="w-9 h-9 text-white ml-1" fill="currentColor" />
                  </span>
                </span>
              </button>
            )}
          </div>
          <p className="mt-3 text-center text-sm text-cyber-muted">
            {t("hiw.videoCaption")}
          </p>
        </motion.div>

        <div className="space-y-12">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, x: i % 2 === 0 ? -30 : 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className={`flex items-start gap-6 ${
                i % 2 === 0 ? "" : "flex-row-reverse text-right"
              }`}
            >
              <div className="shrink-0">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-neon-purple to-electric-blue flex items-center justify-center">
                    <step.icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-background border-2 border-neon-purple flex items-center justify-center text-xs font-bold text-neon-purple">
                    {i + 1}
                  </div>
                </div>
              </div>
              <div className="pt-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  {step.title}
                </h3>
                <p className="text-cyber-muted mb-2">{step.description}</p>
                <p className="text-xs text-neon-purple/70 font-mono">{step.detail}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

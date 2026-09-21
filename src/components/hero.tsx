"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck, Fingerprint, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import DemoModal from "@/components/demo-modal";
import AuditTeaser from "@/components/audit-teaser";
import TransformationVisual from "@/components/transformation-visual";
import { track } from "@/lib/track";

/**
 * Centered single-flow hero: promise → CTAs → honest trust chips → the free
 * audit as instant proof → the recording-to-assets transformation. One story,
 * top to bottom; no sample metrics, no unbacked claims.
 */
export default function Hero() {
  const { t } = useTranslation();
  const [showDemo, setShowDemo] = useState(false);

  const chips = [
    { icon: BadgeCheck, label: t("hero.chip1") },
    { icon: ShieldCheck, label: t("hero.chip2") },
    { icon: Fingerprint, label: t("hero.chip3") },
  ];

  return (
    <section className="relative pt-28 pb-12 lg:pt-32 overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-purple/10 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-electric-blue/10 rounded-full blur-[128px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,var(--color-background)_70%)]" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neon-purple/10 border border-neon-purple/20 text-neon-purple text-sm mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            {t("hero.badge")}
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-5 max-w-3xl mx-auto">
            {t("hero.title1")}{" "}
            <span className="gradient-text">{t("hero.title2")}</span>
            <br />
            <span className="text-fuchsia-400">{t("hero.title3")}</span>
          </h1>
          <p className="text-lg text-cyber-muted max-w-2xl mx-auto mb-7">
            {t("hero.description")}
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/signup"
              onClick={() => track("cta_start_forging")}
              className="px-8 py-3.5 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium hover:opacity-90 transition-opacity"
            >
              {t("hero.cta1")}
            </Link>
            <button
              type="button"
              onClick={() => {
                track("cta_see_how");
                setShowDemo(true);
              }}
              className="px-8 py-3.5 rounded-full border border-cyber-border text-foreground hover:border-neon-purple/50 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              {t("hero.cta2")}
            </button>
          </div>

          {/* Honest trust chips — capabilities, not sample metrics */}
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-5">
            {chips.map((c) => (
              <span
                key={c.label}
                className="flex items-center gap-1.5 text-xs text-cyber-muted"
              >
                <c.icon className="w-3.5 h-3.5 text-neon-purple" /> {c.label}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Instant proof: the free audit, one slot below the promise */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="max-w-3xl mx-auto mt-12"
          id="audit"
        >
          <AuditTeaser embedded />

          {/* Standout companion: the website score for creators whose home
              base is a blog/site rather than a channel. English marketing
              surface, like the tool itself. */}
          <div className="mt-4 flex justify-center">
            <Link
              href="/tools/website-score"
              onClick={() => track("cta_website_score")}
              className="group relative inline-flex items-center gap-3 px-6 py-3 rounded-full bg-gradient-to-r from-fuchsia-500 via-neon-purple to-electric-blue text-white text-sm font-semibold shadow-lg shadow-neon-purple/40 hover:brightness-110 hover:shadow-neon-purple/60 transition-all"
            >
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-bold tracking-widest uppercase">
                New
              </span>
              Got a website instead? Score it free
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </motion.div>

        {/* Show, don't tell: one recording → the month of content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-14"
        >
          <TransformationVisual />
        </motion.div>
      </div>

      <DemoModal open={showDemo} onClose={() => setShowDemo(false)} />
    </section>
  );
}

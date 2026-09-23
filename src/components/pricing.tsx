"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  X,
  Sparkles,
  Zap,
  Crown,
  Gift,
  ArrowRight,
  Lock,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import type {
  PricingConfig,
  PlanData,
  OneOffData,
} from "@/lib/server/pricing";

const ICONS: Record<string, LucideIcon> = {
  gift: Gift,
  rocket: Rocket,
  zap: Zap,
  sparkles: Sparkles,
  crown: Crown,
};

export default function Pricing() {
  const router = useRouter();
  const { user, addToast } = useApp();
  const { t } = useTranslation();
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [annual, setAnnual] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/pricing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => active && data && setConfig(data))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const plans = config?.plans ?? [];
  const oneOffs = config?.oneOffs ?? [];
  const comparison = config?.comparison ?? [];
  const proPlan =
    plans.find((p) => p.priceId === "creatorPro") ?? plans[plans.length - 2];

  function handlePlanClick(plan: PlanData) {
    if (plan.priceId === "agency") {
      router.push("/contact");
      return;
    }
    if (plan.isFree) {
      if (user) {
        addToast(t("pricing.alreadyFree"), "info");
      } else {
        addToast(t("pricing.startFree"));
        router.push("/signup");
      }
      return;
    }
    if (!user) {
      addToast(t("pricing.signUpFirst"), "info");
      router.push("/signup");
      return;
    }
    addToast(t("pricing.planSelected", { plan: t(plan.nameKey) }));
    setTimeout(() => {
      addToast(t("pricing.demoMode"), "info");
    }, 1500);
  }

  const oneoffKey = (id: string, part: "Name" | "Items") =>
    `pricing.oneoff${id.charAt(0).toUpperCase()}${id.slice(1)}${part}`;

  async function handleOneOffClick(pkg: OneOffData) {
    if (!user) {
      addToast(t("pricing.signUpFirst"), "info");
      router.push("/signup");
      return;
    }
    // The single audit has its own product page with URL entry + checkout.
    if (pkg.id === "auditOne") {
      router.push("/site-audit");
      return;
    }
    try {
      const res = await fetch("/api/checkout/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: pkg.id }),
      });
      const data = await res.json().catch(() => null);
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else if (data?.granted) {
        addToast(`${t(oneoffKey(pkg.id, "Name"))} added to your account.`, "success");
      } else if (data?.demo) {
        addToast(String(data.error), "info");
      } else {
        addToast(String(data?.error ?? "Checkout could not be started — try again."), "error");
      }
    } catch {
      addToast("Checkout could not be started — try again.", "error");
    }
  }

  return (
    <section id="pricing" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            {t("pricing.title1")} <span className="gradient-text">{t("pricing.title2")}</span>
          </h2>
          <p className="text-cyber-muted max-w-2xl mx-auto">
            {t("pricing.description")}
          </p>
          <p className="mt-4 text-sm text-neon-purple/90 max-w-2xl mx-auto">
            {t("pricing.managedNote")}
          </p>

          <div className="mt-6 inline-flex items-center gap-1 p-1 rounded-full bg-cyber-card border border-cyber-border text-sm">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-1.5 rounded-full transition-colors ${!annual ? "bg-gradient-to-r from-neon-purple to-electric-blue text-white" : "text-cyber-muted"}`}
            >
              {t("pricing.monthlyLabel")}
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-1.5 rounded-full transition-colors inline-flex items-center gap-2 ${annual ? "bg-gradient-to-r from-neon-purple to-electric-blue text-white" : "text-cyber-muted"}`}
            >
              {t("pricing.annualLabel")}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${annual ? "bg-white/20" : "bg-success/15 text-success"}`}>
                {t("pricing.annualSave")}
              </span>
            </button>
          </div>
        </motion.div>

        {/* Plan Cards */}
        {!config ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-16">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[520px] rounded-2xl border border-cyber-border bg-cyber-card/50 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-16">
            {plans.map((plan, i) => {
              const Icon = ICONS[plan.icon] ?? Zap;
              return (
                <motion.div
                  key={plan.priceId}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className={`relative bg-cyber-card border rounded-2xl p-7 flex flex-col ${
                    plan.popular
                      ? "border-neon-purple glow-purple"
                      : plan.isFree
                      ? "border-cyber-border border-dashed"
                      : "border-cyber-border card-hover"
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-xs font-medium text-white">
                      {t("pricing.mostPopular")}
                    </div>
                  )}
                  {plan.isFree && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-cyber-dark border border-cyber-border text-xs font-medium text-cyber-muted">
                      {t("pricing.noCard")}
                    </div>
                  )}
                  <div
                    className={`w-11 h-11 rounded-xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-4`}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{t(plan.nameKey)}</h3>
                  <p className="text-sm text-cyber-muted mb-3">{t(plan.descKey)}</p>
                  <div className="mb-5">
                    {plan.price === "Free" ? (
                      <>
                        <span className="text-4xl font-bold text-foreground">$0</span>
                        <span className="text-cyber-muted ml-1">{t(plan.periodKey)}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-4xl font-bold text-foreground">
                          ${annual ? Math.round((plan.price as number) * 10 / 12) : plan.price}
                        </span>
                        <span className="text-cyber-muted">{t(plan.periodKey)}</span>
                        {annual && (
                          <span className="block text-[11px] text-success mt-0.5">
                            {t("pricing.billedYearly")}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => handlePlanClick(plan)}
                    className={`w-full py-3 rounded-full font-medium text-sm transition-all hover:opacity-90 mb-6 cursor-pointer ${
                      plan.popular
                        ? "bg-gradient-to-r from-neon-purple to-electric-blue text-white"
                        : plan.isFree
                        ? "bg-cyber-dark border border-cyber-border text-foreground hover:border-neon-purple/50 hover:text-neon-purple"
                        : "bg-cyber-dark border border-cyber-border text-foreground hover:border-neon-purple/50"
                    }`}
                  >
                    {t(plan.ctaKey)}
                  </button>
                  <ul className="space-y-2.5 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature.key} className="flex items-start gap-2.5 text-sm">
                        {feature.included ? (
                          <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
                        ) : feature.upgrade ? (
                          <Lock className="w-4 h-4 text-cyber-muted/40 mt-0.5 shrink-0" />
                        ) : (
                          <X className="w-4 h-4 text-red-500/40 mt-0.5 shrink-0" />
                        )}
                        <span className={feature.included ? "text-cyber-muted" : "text-cyber-muted/40 line-through"}>
                          {t(feature.key)}
                        </span>
                        {feature.upgrade && (
                          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple whitespace-nowrap shrink-0">
                            PRO
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>

                  {plan.isFree && proPlan && (
                    <div className="mt-5 pt-4 border-t border-cyber-border">
                      <button
                        onClick={() => handlePlanClick(proPlan)}
                        className="w-full flex items-center justify-center gap-2 text-xs text-neon-purple hover:underline"
                      >
                        {t("pricing.compareWithPro")} <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Free vs Paid Comparison Strip */}
        {config && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <div className="bg-gradient-to-r from-neon-purple/5 via-electric-blue/5 to-neon-purple/5 border border-cyber-border rounded-2xl p-8">
              <h3 className="text-lg font-bold text-center text-foreground mb-2">
                {t("pricing.whyUpgrade")}
              </h3>
              <p className="text-sm text-cyber-muted text-center mb-8">
                {t("pricing.whyUpgradeDesc")}
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {comparison.map((item) => (
                  <div key={item.labelKey} className="text-center">
                    <p className="text-xs text-cyber-muted mb-2 uppercase tracking-wider">{t(item.labelKey)}</p>
                    <div className="flex items-center justify-center gap-3">
                      <div className="text-center">
                        <p className="text-sm text-red-400/70 line-through">{t(item.freeKey)}</p>
                        <p className="text-[10px] text-cyber-muted">Free</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-neon-purple" />
                      <div className="text-center">
                        <p className="text-sm font-semibold text-success">{t(item.paidKey)}</p>
                        <p className="text-[10px] text-cyber-muted">Paid</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {proPlan && (
                <div className="text-center mt-8">
                  <button
                    onClick={() => handlePlanClick(proPlan)}
                    className="px-6 py-2.5 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    {t("pricing.upgradeToPro")}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* One-Off Packages */}
        {config && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h3 className="text-xl font-bold text-center mb-8">
              {t("pricing.oneOffPackages")}
            </h3>
            <div className="grid sm:grid-cols-3 gap-4">
              {oneOffs.map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => handleOneOffClick(pkg)}
                  className="bg-cyber-card border border-cyber-border rounded-xl p-6 text-center card-hover cursor-pointer"
                >
                  <p className="font-medium text-foreground mb-1">{t(oneoffKey(pkg.id, "Name"))}</p>
                  <p className="text-2xl font-bold gradient-text mb-1">${pkg.price}</p>
                  <p className="text-sm text-cyber-muted">{t(oneoffKey(pkg.id, "Items"))}</p>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}

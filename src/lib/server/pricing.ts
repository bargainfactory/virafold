/**
 * Canonical pricing configuration — the single source of truth for plans,
 * one-off packages, and the free-vs-paid comparison strip.
 *
 * This is stored as serializable data (translation KEYS, not resolved text, and
 * icon NAMES, not components) so it can be persisted in SQLite and served over
 * HTTP by /api/pricing. The client resolves keys through i18n and maps icon
 * names to components at render time. Change prices/allotments here (or later,
 * directly in the DB) without touching the presentation layer.
 */

export interface PlanFeatureData {
  key: string;
  included: boolean;
  upgrade?: boolean;
}

export interface PlanData {
  priceId: string;
  nameKey: string;
  descKey: string;
  price: number | "Free";
  periodKey: string;
  icon: string; // "gift" | "rocket" | "zap" | "sparkles" | "crown"
  color: string;
  features: PlanFeatureData[];
  ctaKey: string;
  popular: boolean;
  isFree?: boolean;
}

export interface OneOffData {
  id: string;
  name: string;
  price: number;
  items: string;
}

export interface ComparisonData {
  freeKey: string;
  paidKey: string;
  labelKey: string;
}

export interface PricingConfig {
  plans: PlanData[];
  oneOffs: OneOffData[];
  comparison: ComparisonData[];
}

/**
 * Bump when DEFAULT_PRICING changes shape or copy — getPricingConfig reseeds
 * the stored DB copy when the stored version differs, so pricing edits ship
 * with the deploy instead of being shadowed by the first-ever seeded config.
 */
export const PRICING_VERSION = 4;

/** Checkout priceId → the plan name stored on users. */
export const PRICE_ID_TO_PLAN: Record<string, string> = {
  free: "Free",
  lite: "Lite",
  starter: "Starter",
  creatorPro: "Creator Pro",
  agency: "Agency",
};

/**
 * Monthly project-generation allowance per plan (a "project" is one upload →
 * asset-set generation). Infinity = unmetered. Enforced by /api/projects.
 */
export const PLAN_MONTHLY_PROJECTS: Record<string, number> = {
  Free: 1,
  Lite: 2,
  Starter: 4,
  "Creator Pro": 8,
  Agency: Number.POSITIVE_INFINITY,
};

export const DEFAULT_PRICING: PricingConfig = {
  plans: [
    {
      priceId: "free",
      nameKey: "pricing.freeName",
      descKey: "pricing.freeDesc",
      price: "Free",
      periodKey: "pricing.forever",
      icon: "gift",
      color: "from-gray-500 to-gray-600",
      isFree: true,
      popular: false,
      ctaKey: "pricing.startFree",
      features: [
        { key: "feat.1videoMonth", included: true },
        { key: "feat.clipsScored", included: true },
        { key: "feat.advancedCaptions", included: true },
        { key: "feat.repurposePack", included: true },
        { key: "feat.scriptVideo", included: true },
        { key: "feat.freeTools", included: true },
        { key: "feat.watermark", included: true },
        { key: "feat.noWatermark", included: false, upgrade: true },
        { key: "feat.voiceClone", included: false, upgrade: true },
        { key: "feat.clientAccounts", included: false, upgrade: true },
      ],
    },
    {
      priceId: "lite",
      nameKey: "pricing.liteName",
      descKey: "pricing.liteDesc",
      price: 189,
      periodKey: "pricing.month",
      icon: "rocket",
      color: "from-emerald-500 to-cyan-500",
      popular: false,
      ctaKey: "pricing.getStarted",
      features: [
        { key: "feat.2videos", included: true },
        { key: "feat.everythingFree", included: true },
        { key: "feat.noWatermark", included: true },
        { key: "feat.aiVoiceover", included: true },
        { key: "feat.smartSchedule", included: true },
        { key: "feat.trendRadar", included: true },
        { key: "feat.watchlist", included: true },
        { key: "feat.abTesting", included: true },
        { key: "feat.bioMediaKit", included: true },
        { key: "feat.emailSupport", included: true },
        { key: "feat.voiceClone", included: false, upgrade: true },
        { key: "feat.clientAccounts", included: false, upgrade: true },
      ],
    },
    {
      priceId: "starter",
      nameKey: "pricing.starterName",
      descKey: "pricing.starterDesc",
      price: 497,
      periodKey: "pricing.month",
      icon: "zap",
      color: "from-electric-blue to-electric-blue-light",
      popular: false,
      ctaKey: "pricing.getStarted",
      features: [
        { key: "feat.4videos", included: true },
        { key: "feat.everythingLite", included: true },
        { key: "feat.voiceClone", included: true },
        { key: "feat.thumbsHighlights", included: true },
        { key: "feat.sourcesAny", included: true },
        { key: "feat.evergreen", included: true },
        { key: "feat.approvalLinks", included: true },
        { key: "feat.revenueTracker", included: true },
        { key: "feat.exportPacks", included: true },
        { key: "feat.emailSupport", included: true },
        { key: "feat.clientAccounts", included: false, upgrade: true },
      ],
    },
    {
      priceId: "creatorPro",
      nameKey: "pricing.proName",
      descKey: "pricing.proDesc",
      price: 997,
      periodKey: "pricing.month",
      icon: "sparkles",
      color: "from-neon-purple to-neon-purple-light",
      popular: true,
      ctaKey: "pricing.startCreating",
      features: [
        { key: "feat.8videos", included: true },
        { key: "feat.everythingStarter", included: true },
        { key: "feat.2clients", included: true },
        { key: "feat.quotaShare", included: true },
        { key: "feat.clientSwitch", included: true },
        { key: "feat.allPlatforms", included: true },
        { key: "feat.weeklyBrief", included: true },
        { key: "feat.provenance", included: true },
        { key: "feat.priority", included: true },
      ],
    },
    {
      priceId: "agency",
      nameKey: "pricing.agencyName",
      descKey: "pricing.agencyDesc",
      price: 2497,
      periodKey: "pricing.month",
      icon: "crown",
      color: "from-amber-500 to-amber-600",
      popular: false,
      ctaKey: "pricing.contactSales",
      features: [
        { key: "feat.unlimited", included: true },
        { key: "feat.everythingPro", included: true },
        { key: "feat.10clients", included: true },
        { key: "feat.quotaShare", included: true },
        { key: "feat.clientSwitch", included: true },
        { key: "feat.approvalLinks", included: true },
        { key: "feat.allPlatforms", included: true },
        { key: "feat.provenance", included: true },
        { key: "feat.dedicatedSupport", included: true },
      ],
    },
  ],
  oneOffs: [
    // Real, fulfillable products only — each maps to a shipped feature.
    { id: "auditOne", name: "Complete Content Audit", price: 49, items: "1 site → full audit + written fixes" },
    { id: "auditPack", name: "Agency Audit Pack", price: 349, items: "10 audit credits for client sites" },
    { id: "episodeKit", name: "Podcast Episode Kit", price: 29, items: "+1 project: episode → clips, notes, newsletter" },
  ],
  comparison: [
    { freeKey: "pricing.watermarked", paidKey: "pricing.cleanBranded", labelKey: "pricing.yourClips" },
    { freeKey: "pricing.days7", paidKey: "pricing.sameDay", labelKey: "pricing.turnaround" },
    { freeKey: "pricing.clips3", paidKey: "pricing.clips160", labelKey: "pricing.monthlyOutput" },
  ],
};

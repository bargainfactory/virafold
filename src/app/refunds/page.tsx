"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

// English by design, like /terms and /privacy — the legally binding copy.
const sections = [
  {
    title: "Cancelling a Subscription",
    content:
      "You can cancel your subscription at any time — no phone calls, no retention flows. Email justin@virafold.ai from your account email (or use the contact page) and we'll confirm the cancellation within 2 business days. You keep full access until the end of the billing period you've already paid for, and you are not charged again after that.",
  },
  {
    title: "Subscription Refunds",
    content:
      "Monthly fees for a billing period that has already started are generally not refunded — you keep access for the time you paid for instead. We always refund in full: duplicate charges, charges made after you asked us to cancel, and billing errors on our side. If you were charged for a month in which our service was materially unavailable to you, tell us and we'll make it right.",
  },
  {
    title: "One-Off Purchases",
    content:
      "Complete Content Audit ($49) and Agency Audit Pack credits: if we cannot crawl your site and produce a report, you are refunded for that audit — we do not keep money for reports we couldn't deliver. Unused audit credits from a pack are refundable within 14 days of purchase. Podcast Episode Kits are refundable within 14 days if the bonus project hasn't been used.",
  },
  {
    title: "How to Request a Refund",
    content:
      "Email justin@virafold.ai from the email address on your account, with the approximate charge date and amount. We respond within 2 business days. Approved refunds are issued to the original payment method through Stripe and typically appear in 5–10 business days depending on your bank.",
  },
  {
    title: "Your Statutory Rights",
    content:
      "Nothing in this policy limits rights you have under applicable law. If you are a consumer in the EU, UK, or another jurisdiction with mandatory withdrawal or refund rights for digital services, those rights apply in addition to this policy.",
  },
  {
    title: "Chargebacks",
    content:
      "Before disputing a charge with your bank, please contact us first — we resolve billing issues quickly and a direct refund is faster for you than a dispute. Accounts with fraudulent chargebacks may be suspended.",
  },
];

export default function RefundsPage() {
  const { t } = useTranslation();
  return (
    <>
      <Navbar />
      <main className="pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-cyber-muted hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("nav.backHome")}
          </Link>

          <h1 className="text-3xl font-bold text-foreground mb-2">Refund & Cancellation Policy</h1>
          <p className="text-sm text-cyber-muted mb-10">Last updated: September 25, 2026</p>

          <div className="space-y-8">
            {sections.map((section, i) => (
              <div key={section.title}>
                <h2 className="text-lg font-semibold text-foreground mb-2">
                  {i + 1}. {section.title}
                </h2>
                <p className="text-foreground/70 leading-relaxed">{section.content}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 pt-8 border-t border-cyber-border">
            <p className="text-sm text-cyber-muted">
              Questions about billing? Email{" "}
              <a href="mailto:justin@virafold.ai" className="text-neon-purple hover:underline">
                justin@virafold.ai
              </a>{" "}
              — we answer within 2 business days.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

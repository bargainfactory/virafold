"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

const sections = [
  {
    title: "Acceptance of Terms",
    content: "By accessing or using Virafold's services, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.",
  },
  {
    title: "Service Description",
    content: "Virafold provides AI-powered content repurposing services, including but not limited to: video/audio transcription, short-form content generation, carousel design, newsletter creation, and automated publishing. Services are provided on a subscription or one-off basis as described in our pricing.",
  },
  {
    title: "User Accounts",
    content: "You are responsible for maintaining the security of your account credentials. You must provide accurate information during registration. You may not share your account with others or allow unauthorized access to your dashboard.",
  },
  {
    title: "Content Ownership",
    content: "You retain full ownership of all content you upload to Virafold. You grant us a limited license to process your content solely for the purpose of providing our repurposing services. Generated assets are owned by you upon delivery. We claim no ownership over your original or repurposed content.",
  },
  {
    title: "Acceptable Use",
    content: "You may not use our services to process content that is illegal, infringing, defamatory, or harmful. You are responsible for ensuring you have the rights to all content you upload. We reserve the right to refuse processing of content that violates these terms.",
  },
  {
    title: "Payment Terms",
    content: "Subscription fees are billed monthly in advance. One-off packages are billed at the time of purchase. All fees are non-refundable except as required by law or as specified in our Refund & Cancellation Policy (virafold.ai/refunds). We may change pricing with 30 days' notice.",
  },
  {
    title: "Service Availability",
    content: "We strive for 99.9% uptime but do not guarantee uninterrupted service. We may perform scheduled maintenance with advance notice. We are not liable for service interruptions caused by factors beyond our control.",
  },
  {
    title: "Limitation of Liability",
    content: "Virafold's total liability for any claim arising from use of our services is limited to the amount you paid us in the 12 months preceding the claim. We are not liable for indirect, incidental, or consequential damages.",
  },
  {
    title: "Termination",
    content: "Either party may terminate the agreement at any time. Upon termination, you retain access to your content and generated assets for 30 days. After 30 days, your data may be deleted. We may terminate accounts that violate these terms immediately.",
  },
];

export default function TermsPage() {
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

          <h1 className="text-3xl font-bold text-foreground mb-2">{t("terms.title")}</h1>
          <p className="text-sm text-cyber-muted mb-10">Last updated: April 1, 2025</p>

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
              Questions about these terms? Contact us at{" "}
              <a href="mailto:justin@virafold.ai" className="text-neon-purple hover:underline">
                justin@virafold.ai
              </a>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

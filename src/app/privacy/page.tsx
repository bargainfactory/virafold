"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

const sections = [
  {
    title: "Information We Collect",
    content: "We collect information you provide directly, including your name, email address, payment information, and content you upload to our platform. We also collect usage data such as pages visited, features used, and interaction patterns to improve our services.",
  },
  {
    title: "How We Use Your Information",
    content: "Your information is used to provide and improve our AI content repurposing services, process payments, communicate with you about your account, and send relevant updates about new features and service improvements.",
  },
  {
    title: "Content & Data Processing",
    content: "Content you upload is processed by our AI pipeline to generate repurposed assets. Your original content and generated assets are stored securely and are only accessible by you and authorized team members. We do not use your content to train our AI models without explicit consent.",
  },
  {
    title: "Data Sharing",
    content: "We do not sell your personal information. We may share data with trusted service providers (payment processors, cloud hosting, analytics) who are bound by data protection agreements. We may also share data when required by law.",
  },
  {
    title: "Data Security",
    content: "We implement industry-standard security measures including encryption in transit and at rest, regular security audits, access controls, and secure data centers. We use SOC 2 compliant infrastructure for all data storage.",
  },
  {
    title: "Your Rights",
    content: "You have the right to access, correct, or delete your personal data at any time. You can export your content and assets, and request complete account deletion. Contact justin@virafold.ai for any data requests.",
  },
  {
    title: "Cookies",
    content: "We use essential cookies for authentication and session management, and optional analytics cookies to understand how our platform is used. You can manage cookie preferences in your browser settings.",
  },
  {
    title: "Changes to This Policy",
    content: "We may update this privacy policy from time to time. We will notify you of significant changes via email or through an in-app notification. Continued use of our services after changes constitutes acceptance.",
  },
];

export default function PrivacyPage() {
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

          <h1 className="text-3xl font-bold text-foreground mb-2">{t("privacy.title")}</h1>
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
              Questions about this policy? Contact us at{" "}
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Mail, MapPin, Clock, CheckCircle } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { useTranslation } from "@/lib/i18n";

export default function ContactPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t("contact.errorNameRequired");
    if (!form.email.trim()) e.email = t("contact.errorEmailRequired");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = t("contact.errorEmailInvalid");
    if (!form.subject.trim()) e.subject = t("contact.errorSubjectRequired");
    if (!form.message.trim()) e.message = t("contact.errorMessageRequired");
    else if (form.message.trim().length < 10) e.message = t("contact.errorMessageLength");
    return e;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setSubmitted(true);
    }, 1500);
  }

  return (
    <>
      <Navbar />
      <main className="pt-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-cyber-muted hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("nav.backHome")}
          </Link>

          <h1 className="text-3xl sm:text-4xl font-bold mb-4">
            {t("contact.title1")} <span className="gradient-text">{t("contact.title2")}</span>
          </h1>
          <p className="text-cyber-muted mb-12 max-w-lg">
            {t("contact.description")}
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-2">
              {submitted ? (
                <div className="bg-cyber-card border border-success/30 rounded-2xl p-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-success" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground mb-2">{t("contact.sent")}</h2>
                  <p className="text-cyber-muted mb-6">
                    {t("contact.sentDesc")}
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setForm({ name: "", email: "", subject: "", message: "" });
                    }}
                    className="px-6 py-2.5 rounded-xl bg-cyber-dark border border-cyber-border text-sm text-foreground hover:border-neon-purple/50 transition-colors"
                  >
                    {t("contact.sendAnother")}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="bg-cyber-card border border-cyber-border rounded-2xl p-8 space-y-5">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">{t("contact.name")}</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder={t("contact.yourName")}
                        className={`w-full px-4 py-2.5 bg-cyber-dark border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 ${errors.name ? "border-red-500/50" : "border-cyber-border"}`}
                      />
                      {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">{t("auth.email")}</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder="you@example.com"
                        className={`w-full px-4 py-2.5 bg-cyber-dark border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 ${errors.email ? "border-red-500/50" : "border-cyber-border"}`}
                      />
                      {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">{t("contact.subject")}</label>
                    <select
                      value={form.subject}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      className={`w-full px-4 py-2.5 bg-cyber-dark border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50 ${errors.subject ? "border-red-500/50" : "border-cyber-border"}`}
                    >
                      <option value="">{t("contact.selectTopic")}</option>
                      <option value="General Inquiry">{t("contact.generalInquiry")}</option>
                      <option value="Pricing Question">{t("contact.pricingQuestion")}</option>
                      <option value="Custom Package">{t("contact.customPackage")}</option>
                      <option value="Technical Support">{t("contact.techSupport")}</option>
                      <option value="Partnership">{t("contact.partnership")}</option>
                    </select>
                    {errors.subject && <p className="mt-1 text-xs text-red-400">{errors.subject}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">{t("contact.message")}</label>
                    <textarea
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder={t("contact.messagePlaceholder")}
                      rows={5}
                      className={`w-full px-4 py-2.5 bg-cyber-dark border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 resize-none ${errors.message ? "border-red-500/50" : "border-cyber-border"}`}
                    />
                    {errors.message && <p className="mt-1 text-xs text-red-400">{errors.message}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={sending}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {sending ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        {t("contact.send")}
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>

            <div className="space-y-4">
              {[
                { icon: Mail, labelKey: "contact.emailLabel", value: "justin@virafold.ai" },
                { icon: MapPin, labelKey: "contact.location", value: "New York, NY" },
                { icon: Clock, labelKey: "contact.responseTime", valueKey: "contact.within24h" },
              ].map((item) => (
                <div key={item.labelKey} className="bg-cyber-card border border-cyber-border rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5 text-neon-purple" />
                    <div>
                      <p className="text-xs text-cyber-muted">{t(item.labelKey)}</p>
                      <p className="text-sm font-medium text-foreground">
                        {item.valueKey ? t(item.valueKey) : item.value}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

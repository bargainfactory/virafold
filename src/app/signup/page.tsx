"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { useTranslation } from "@/lib/i18n";
import { Zap, Eye, EyeOff, Check } from "lucide-react";
import GoogleButton from "@/components/google-button";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useApp();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [company, setCompany] = useState(""); // honeypot — humans never see it
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const checks = [
    { label: t("auth.minChars"), met: password.length >= 8 },
    { label: t("auth.hasNumber"), met: /\d/.test(password) },
    { label: t("auth.hasUppercase"), met: /[A-Z]/.test(password) },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name) return setError(t("auth.nameRequired"));
    if (!email) return setError(t("auth.emailRequired"));
    if (password.length < 8) return setError(t("auth.passwordLength"));
    setSubmitting(true);
    try {
      const ok = await signup(name, email, password, company);
      if (ok) router.push("/dashboard");
      else setError(t("auth.signupFailed"));
    } catch {
      setError(t("auth.signupFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-purple/5 rounded-full blur-[128px]" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-electric-blue/5 rounded-full blur-[128px]" />

      {/* Honeypot: invisible to humans, bots fill it; the API quietly drops
          those signups (returns success-shaped, creates nothing). */}
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <img src="/logo.png" alt="Virafold" className="w-10 h-10 rounded-full" />
            <span className="text-xl font-bold gradient-text">Virafold</span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{t("auth.createAccount")}</h1>
          <p className="text-sm text-cyber-muted mt-1">{t("auth.createAccountDesc")}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-cyber-card border border-cyber-border rounded-2xl p-8 space-y-5">
          {error && (
            <div className="px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <GoogleButton label="Sign up with Google" />
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-cyber-border" />
            <span className="text-xs text-cyber-muted">or</span>
            <div className="h-px flex-1 bg-cyber-border" />
          </div>

          <div className="absolute -left-[9999px] top-0 h-0 overflow-hidden" aria-hidden="true">
            <label htmlFor="vf-company">Company</label>
            <input
              id="vf-company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t("auth.fullName")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full px-4 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t("auth.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-2.5 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t("auth.password")}</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                className="w-full px-4 py-2.5 pr-10 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-cyber-muted hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {checks.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-xs">
                  <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${c.met ? "bg-success/20 text-success" : "bg-cyber-border text-cyber-muted"}`}>
                    {c.met && <Check className="w-2.5 h-2.5" />}
                  </div>
                  <span className={c.met ? "text-success" : "text-cyber-muted"}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {t("auth.createBtn")}
          </button>

          <p className="text-center text-sm text-cyber-muted">
            {t("auth.hasAccount")}{" "}
            <Link href="/login" className="text-neon-purple hover:underline">
              {t("auth.signInLink")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

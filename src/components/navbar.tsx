"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Menu, X, Zap } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import LanguageSwitcher from "@/components/language-switcher";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const pathname = usePathname();
  const { t } = useTranslation();

  // Product-first SaaS nav: six focused links, each a real page.
  const links = [
    { href: "/product", label: t("nav.services") },
    { href: "/how-it-works", label: t("nav.howItWorks") },
    { href: "/examples", label: t("nav.portfolio") },
    { href: "/tools", label: t("footer.freeTools") },
    { href: "/pricing", label: t("nav.pricing") },
    { href: "/blog", label: t("nav.blog") },
  ];

  // Persona funnels — the parallel doors into the same product.
  const solutions = [
    { href: "/for/podcasters", label: t("footer.forPodcasters") },
    { href: "/for/podcast-guests", label: t("footer.forGuests") },
    { href: "/for/coaches", label: t("footer.forCoaches") },
    { href: "/for/course-creators", label: t("footer.forCourses") },
    { href: "/for/writers", label: t("footer.forWriters") },
    { href: "/for/agencies", label: t("footer.forAgencies") },
    { href: "/for/saas", label: t("footer.forSaas") },
    { href: "/for/local-business", label: t("footer.forLocal") },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-cyber-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 group">
            <img src="/logo.png" alt="Virafold" className="w-8 h-8 rounded-full" />
            <span className="text-lg font-bold gradient-text">Virafold</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {/* Solutions dropdown: who Virafold is for */}
            <div
              className="relative"
              onMouseEnter={() => setSolutionsOpen(true)}
              onMouseLeave={() => setSolutionsOpen(false)}
            >
              <button
                onClick={() => setSolutionsOpen((v) => !v)}
                className={`text-sm transition-colors flex items-center gap-1 ${
                  pathname.startsWith("/for/")
                    ? "text-foreground"
                    : "text-cyber-muted hover:text-foreground"
                }`}
              >
                {t("footer.solutions")}
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${solutionsOpen ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence>
                {solutionsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 top-full pt-2"
                  >
                    <div className="w-52 bg-background/95 backdrop-blur-xl border border-cyber-border rounded-xl p-1.5 shadow-xl shadow-black/30">
                      {solutions.map((s) => (
                        <Link
                          key={s.href}
                          href={s.href}
                          onClick={() => setSolutionsOpen(false)}
                          className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                            pathname === s.href
                              ? "text-neon-purple bg-neon-purple/10"
                              : "text-cyber-muted hover:text-foreground hover:bg-cyber-card"
                          }`}
                        >
                          {s.label}
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm transition-colors ${
                  pathname === link.href ? "text-foreground" : "text-cyber-muted hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              href="/login"
              className="text-sm text-cyber-muted hover:text-foreground transition-colors px-4 py-2"
            >
              {t("nav.login")}
            </Link>
            <Link
              href="/signup"
              className="text-sm font-medium px-5 py-2 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white hover:opacity-90 transition-opacity"
            >
              {t("nav.getStarted")}
            </Link>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 text-cyber-muted"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-cyber-border bg-background/95 backdrop-blur-xl"
          >
            <div className="px-4 py-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-cyber-muted/70 pt-1">
                {t("footer.solutions")}
              </p>
              {solutions.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={() => setOpen(false)}
                  className="block text-sm text-cyber-muted hover:text-foreground transition-colors py-2"
                >
                  {s.label}
                </Link>
              ))}
              <div className="border-t border-cyber-border pt-3" />
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block text-sm text-cyber-muted hover:text-foreground transition-colors py-2"
                >
                  {link.label}
                </Link>
              ))}
              <div className="pt-3 border-t border-cyber-border space-y-2">
                <Link href="/login" onClick={() => setOpen(false)} className="block text-sm text-cyber-muted py-2">
                  {t("nav.login")}
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setOpen(false)}
                  className="block text-center text-sm font-medium px-5 py-2.5 rounded-full bg-gradient-to-r from-neon-purple to-electric-blue text-white"
                >
                  {t("nav.getStarted")}
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

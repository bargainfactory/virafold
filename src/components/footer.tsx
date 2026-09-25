"use client";

import Link from "next/link";
import { Video } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

// Only profiles that actually exist — placeholders pointed at platform
// homepages cost more trust than no icon. Add X/TikTok/LinkedIn here as
// their real handles get claimed.
const socials = [
  { icon: Video, href: "https://www.youtube.com/@virafold", label: "YouTube" },
];

export default function Footer() {
  const { t } = useTranslation();

  const footerLinks = {
    [t("footer.services")]: [
      { label: t("services.youtube"), href: "/product" },
      { label: t("services.tiktok"), href: "/product" },
      { label: t("services.linkedin"), href: "/product" },
      { label: t("services.email"), href: "/product" },
      { label: t("services.carousel"), href: "/product" },
    ],
    [t("footer.solutions")]: [
      { label: t("footer.forPodcasters"), href: "/for/podcasters" },
      { label: t("footer.forCoaches"), href: "/for/coaches" },
      { label: t("footer.forCourses"), href: "/for/course-creators" },
      { label: t("footer.forAgencies"), href: "/for/agencies" },
    ],
    [t("footer.company")]: [
      { label: t("footer.about"), href: "/about" },
      { label: t("nav.blog"), href: "/blog" },
      { label: t("footer.contact"), href: "/contact" },
    ],
    [t("footer.resources")]: [
      { label: t("footer.freeTools"), href: "/tools" },
      { label: t("footer.howItWorks"), href: "/how-it-works" },
      { label: t("footer.pricing"), href: "/pricing" },
      { label: t("footer.successStories"), href: "/examples" },
      { label: t("footer.clientDashboard"), href: "/dashboard" },
    ],
    [t("footer.legal")]: [
      { label: t("footer.privacyPolicy"), href: "/privacy" },
      { label: t("footer.termsOfService"), href: "/terms" },
      { label: t("footer.refundPolicy"), href: "/refunds" },
    ],
  };

  return (
    <footer className="border-t border-cyber-border bg-cyber-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <img src="/logo.png" alt="Virafold" className="w-8 h-8 rounded-full" />
              <span className="text-lg font-bold gradient-text">Virafold</span>
            </Link>
            <p className="text-sm text-cyber-muted mb-6 max-w-xs">
              {t("footer.tagline")}
            </p>
            {/* Visible support contact — card networks (and Stripe's site
                review) require a reachable customer-service address. */}
            <p className="text-sm text-cyber-muted mb-4">
              {t("footer.support")}:{" "}
              <a
                href="mailto:justin@virafold.ai"
                className="text-neon-purple hover:underline"
              >
                justin@virafold.ai
              </a>
            </p>
            <div className="flex gap-3">
              {socials.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-lg bg-cyber-card border border-cyber-border flex items-center justify-center text-cyber-muted hover:text-neon-purple hover:border-neon-purple transition-all"
                >
                  <social.icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-sm font-semibold text-foreground mb-4">{title}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-cyber-muted hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-cyber-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-cyber-muted">
            &copy; {t("footer.rights", { year: new Date().getFullYear() })}
          </p>
          <p className="text-sm text-cyber-muted">
            {t("footer.poweredBy")}
          </p>
        </div>
        <p className="mt-6 text-xs text-cyber-muted/70 text-center max-w-3xl mx-auto">
          {t("footer.demoDisclaimer")}
        </p>
      </div>
    </footer>
  );
}

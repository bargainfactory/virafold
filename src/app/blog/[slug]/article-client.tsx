"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Languages, Loader2, Tag, Share2 } from "lucide-react";
import { blogPosts } from "@/lib/data";
import { locales } from "@/lib/locales";
import { useTranslation } from "@/lib/i18n";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

interface ArticleTranslation {
  title: string;
  excerpt: string;
  content: string[];
}

export default function ArticleClient({ slug }: { slug: string }) {
  const { t, locale } = useTranslation();
  const [langSel, setLangSel] = useState<string>(locale !== "en" ? locale : "es");
  const [xBusy, setXBusy] = useState(false);
  const [xErr, setXErr] = useState<string | null>(null);
  const [tr, setTr] = useState<ArticleTranslation | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const post = blogPosts.find((p) => p.slug === slug);
  if (!post) notFound();

  const active = tr !== null && !showOriginal;

  async function translateNow() {
    if (xBusy) return;
    setXBusy(true);
    setXErr(null);
    try {
      const res = await fetch("/api/translate/blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, locale: langSel }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setXErr(String(data?.error ?? "Translation failed — try again"));
      else {
        setTr(data.translation);
        setShowOriginal(false);
      }
    } catch {
      setXErr("Translation failed — try again");
    } finally {
      setXBusy(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="pt-16">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm text-cyber-muted hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("blog.backToBlog")}
          </Link>

          <div className={`h-48 sm:h-64 rounded-2xl bg-gradient-to-br ${post.gradient} relative mb-8`}>
            <div className="absolute inset-0 bg-black/20 rounded-2xl" />
          </div>

          <div className="flex items-center gap-4 mb-4">
            <span className="flex items-center gap-1.5 text-sm text-neon-purple">
              <Tag className="w-3.5 h-3.5" /> {t(`blog.${post.slug}.category`)}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-cyber-muted">
              <Clock className="w-3.5 h-3.5" /> {t(`blog.${post.slug}.readTime`)}
            </span>
            <span className="text-sm text-cyber-muted">{post.date}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-8 leading-tight">
            {active ? tr!.title : t(`blog.${post.slug}.title`)}
          </h1>

          <div className="flex items-center gap-4 pb-8 mb-8 border-b border-cyber-border">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-purple to-electric-blue flex items-center justify-center text-white text-sm font-bold">
              VF
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Virafold Team</p>
              <p className="text-xs text-cyber-muted">Content Strategy</p>
            </div>
            <button className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyber-card border border-cyber-border text-sm text-cyber-muted hover:text-foreground hover:border-neon-purple/30 transition-colors">
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
          </div>

          {/* On-demand translation: opt-in, honestly labeled, cached server-side */}
          <div className="flex flex-wrap items-center gap-3 mb-8 -mt-2">
            <Languages className="w-4 h-4 text-neon-purple shrink-0" />
            {active ? (
              <>
                <span className="text-xs text-cyber-muted">
                  AI-translated — may contain imperfections.
                </span>
                <button
                  onClick={() => setShowOriginal(true)}
                  className="text-xs text-neon-purple hover:underline"
                >
                  Show original (English)
                </button>
              </>
            ) : (
              <>
                <select
                  value={langSel}
                  onChange={(e) => setLangSel(e.target.value)}
                  className="px-2.5 py-1.5 bg-cyber-card border border-cyber-border rounded-lg text-xs text-foreground focus:outline-none focus:border-neon-purple/50"
                  aria-label="Translation language"
                >
                  {locales
                    .filter((l) => l.code !== "en")
                    .map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.nativeName}
                      </option>
                    ))}
                </select>
                <button
                  onClick={tr ? () => setShowOriginal(false) : translateNow}
                  disabled={xBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyber-card border border-neon-purple/40 text-xs text-neon-purple hover:bg-neon-purple/10 transition-colors disabled:opacity-50"
                >
                  {xBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                  {xBusy
                    ? "Translating… first time can take a minute"
                    : tr
                      ? "Show translation"
                      : "Translate this article"}
                </button>
              </>
            )}
            {xErr && <span className="text-xs text-red-400">{xErr}</span>}
          </div>

          <div className="prose-custom space-y-6">
            {(active ? tr!.content : post.content).map((paragraph, i) =>
              paragraph.startsWith("## ") ? (
                <h2 key={i} className="text-xl font-bold text-foreground pt-4">
                  {paragraph.slice(3)}
                </h2>
              ) : (
                <p key={i} className="text-foreground/80 leading-relaxed">
                  {paragraph}
                </p>
              )
            )}
          </div>

          <div className="mt-12 pt-8 border-t border-cyber-border">
            <h3 className="text-lg font-semibold text-foreground mb-4">{t("blog.related")}</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {blogPosts
                .filter((p) => p.slug !== post.slug && p.category === post.category)
                .slice(0, 2)
                .map((related) => (
                  <Link
                    key={related.slug}
                    href={`/blog/${related.slug}`}
                    className="bg-cyber-card border border-cyber-border rounded-xl p-4 hover:border-neon-purple/30 transition-colors"
                  >
                    <span className="text-xs text-neon-purple">{t(`blog.${related.slug}.category`)}</span>
                    <p className="text-sm font-medium text-foreground mt-1">{t(`blog.${related.slug}.title`)}</p>
                  </Link>
                ))}
            </div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}

"use client";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Tag, Share2 } from "lucide-react";
import { blogPosts } from "@/lib/data";
import { useTranslation } from "@/lib/i18n";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

export default function ArticleClient({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const post = blogPosts.find((p) => p.slug === slug);
  if (!post) notFound();

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
            {t(`blog.${post.slug}.title`)}
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

          <div className="prose-custom space-y-6">
            {post.content.map((paragraph, i) =>
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

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";

/**
 * Persona landing pages: parallel funnels into the same product. The faceless
 * wedge stays on the homepage; each adjacent segment gets its own door with
 * its own pains, answers, and FAQ schema. All claims map to shipped features.
 */

interface Persona {
  name: string;
  slug: string;
  headline: string;
  sub: string;
  pains: { pain: string; fix: string }[];
  features: string[];
  faq: { q: string; a: string }[];
  /** Secondary hero CTA — defaults to the free channel audit. */
  ctaSecondary?: { href: string; label: string };
  /** Closing card — defaults to the free channel audit pitch. */
  closing?: { title: string; sub: string; href: string; label: string };
}

const PERSONAS: Record<string, Persona> = {
  podcasters: {
    name: "Podcasters",
    slug: "podcasters",
    headline: "Every episode is a week of content. Stop leaving it in the archive.",
    sub: "Upload an episode and Virafold transcribes it, finds the most clippable exchanges, renders captioned vertical clips, and writes the newsletter and thread to match — then schedules all of it.",
    pains: [
      {
        pain: "Episodes take hours to make and disappear from feeds in a day.",
        fix: "One upload becomes captioned clips, a newsletter recap, an X thread, and carousel pull-quotes — every episode compounds instead of evaporating.",
      },
      {
        pain: "Finding the best 30 seconds means re-listening to the whole hour.",
        fix: "Highlight detection reads the timestamped transcript and surfaces the moments most likely to travel — scored, with reasons.",
      },
      {
        pain: "Clipping tools don't know your show.",
        fix: "Virafold seeds clip selection with your channel audit and your measured post results, so clips match what already works for your audience.",
      },
    ],
    features: [
      "Automatic transcription with word timestamps",
      "AI highlight detection tuned by your own results",
      "Rendered 9:16 clips with burned-in captions",
      "Newsletter + thread + carousel from the same episode",
      "Schedule straight to YouTube Shorts and TikTok",
      "Owned email list, link-in-bio, and media kit for sponsors",
    ],
    faq: [
      {
        q: "Do I need to edit video myself?",
        a: "No. Virafold cuts, crops to vertical, and burns captions server-side. You preview in the browser, pick a caption style, and render.",
      },
      {
        q: "Does it work with audio-only podcasts?",
        a: "Yes — audio uploads are transcribed the same way and drive text assets (threads, newsletters, carousels). Video episodes additionally unlock rendered clips.",
      },
      {
        q: "How do sponsors fit in?",
        a: "Virafold includes a brand-deal pipeline, a revenue ledger, and an auto-generated media kit page with your rates you can send to any sponsor.",
      },
    ],
  },
  coaches: {
    name: "Coaches",
    slug: "coaches",
    headline: "Your calls are full of content. Turn them into clients.",
    sub: "Record one teaching session and Virafold folds it into a week of posts in your voice — with your call-to-action on every asset — then tracks which topics actually bring people in.",
    pains: [
      {
        pain: "You know content brings clients, but creation time competes with client time.",
        fix: "One recorded session becomes shorts, carousels, an email, and threads — production stops competing with delivery.",
      },
      {
        pain: "Generic AI output doesn't sound like you.",
        fix: "A brand-voice profile — tone, audience, banned words, your CTA — steers every generation, and your proven winners feed future output.",
      },
      {
        pain: "No idea which content converts.",
        fix: "Real post metrics flow back automatically from connected accounts; A/B hook testing settles what resonates with data, not guesses.",
      },
    ],
    features: [
      "Brand voice with your default call-to-action on every asset",
      "Idea backlog with hook scoring — never start from blank",
      "Owned email list with newsletter broadcasts",
      "Link-in-bio page that captures subscribers",
      "A/B hook testing decided by real views",
      "Revenue ledger to track coaching income by stream",
    ],
    faq: [
      {
        q: "I'm not a video editor — how hard is this?",
        a: "Paste a transcript or upload a recording; everything else is generated, previewed, and approved by you in one dashboard. No editing software involved.",
      },
      {
        q: "Can it drive people to my offer, not just get views?",
        a: "Yes — your default CTA is part of your brand voice and lands on generated assets, and the link-in-bio page turns profile visits into an email list you own.",
      },
      {
        q: "What if I only record one session a month?",
        a: "One 45-minute recording typically yields 30+ assets — enough for a month of consistent posting, with evergreen recycling re-queueing your winners automatically.",
      },
    ],
  },
  "course-creators": {
    name: "Course Creators",
    slug: "course-creators",
    headline: "Your course is a content goldmine. Mine it.",
    sub: "Every module you've recorded can market itself — Virafold turns lessons into shorts, carousels, and emails that demonstrate your teaching instead of describing it.",
    pains: [
      {
        pain: "Students can't tell if your teaching style fits before buying.",
        fix: "Clips of actual lessons are the most honest ad — Virafold extracts the clearest teaching moments and captions them for the feed.",
      },
      {
        pain: "Marketing a course means making a second course's worth of content.",
        fix: "The course itself is the content: one module upload becomes a week of posts pointing back at enrollment.",
      },
      {
        pain: "Launches spike, then attention dies.",
        fix: "Evergreen recycling re-queues your best-performing lesson clips automatically, keeping the funnel warm between launches.",
      },
    ],
    features: [
      "Turn recorded modules into captioned vertical clips",
      "Carousels and threads that teach one concept each",
      "Email sequences from your own material",
      "Evergreen recycling keeps proven content circulating",
      "Free channel audit shows which topics pull best",
      "Revenue ledger tracks course income next to content effort",
    ],
    faq: [
      {
        q: "Will clips give away too much of my course?",
        a: "You approve every asset before it ships, and clips are 15–60 second moments — enough to demonstrate value, not enough to replace enrollment.",
      },
      {
        q: "Does it integrate with my course platform?",
        a: "Virafold handles the content and audience side — clips, posts, email list, link-in-bio. Your checkout stays wherever it is; your CTA points to it.",
      },
      {
        q: "Can I test different angles for the same lesson?",
        a: "Yes — one click clones any asset with an alternate hook, both versions publish, and real view counts decide the winner.",
      },
    ],
  },
  agencies: {
    name: "Agencies",
    slug: "agencies",
    headline: "Run every client's content engine from one system.",
    sub: "Repurposing, scheduling, and reporting are the hours that eat agency margin. Virafold automates the pipeline so your team spends time on strategy, not exports.",
    pains: [
      {
        pain: "Every client means another stack of tools and logins.",
        fix: "Generation, clipping, scheduling, audience, and revenue tracking live in one dashboard per workspace.",
      },
      {
        pain: "Repurposing is manual labor billed at strategy rates.",
        fix: "One client recording becomes the month's asset set automatically, in the client's brand voice with their banned words enforced.",
      },
      {
        pain: "Clients ask 'what's working?' and the answer takes a day to compile.",
        fix: "Post metrics flow back automatically and a weekly brief summarizes winners, queue, and revenue — forwardable as-is.",
      },
    ],
    features: [
      "Per-workspace brand voice: tone, CTAs, banned words",
      "Policy/demonetization lint before anything ships",
      "Signed provenance manifest on every asset (C2PA-shaped)",
      "Background scheduler with connected-account delivery",
      "Automatic metrics ingestion and weekly briefs",
      "Brand-deal pipeline and revenue ledger per workspace",
    ],
    faq: [
      {
        q: "How does client approval work?",
        a: "Every generated asset sits in review until approved — nothing publishes without a human decision, and the full edit trail is signed into each asset's provenance record.",
      },
      {
        q: "Can we keep each client's voice separate?",
        a: "Each workspace carries its own brand-voice profile — tone, audience, CTA, hashtags, banned words — enforced on every generation in that workspace.",
      },
      {
        q: "What does reporting look like?",
        a: "Connected accounts report real views, likes, and comments back automatically; the Monday brief compiles winners, the upcoming queue, and booked revenue.",
      },
    ],
  },
  "local-business": {
    name: "Local Businesses",
    slug: "local-business",
    headline: "When someone asks an AI assistant for a recommendation, is your business the answer?",
    sub: "Customers now ask ChatGPT, Claude, and Perplexity before they search Google. Virafold scores how findable your website is — for free, in about a minute — then a $49 Complete Audit hands you the written fixes, and weekly monitoring makes sure you stay found.",
    pains: [
      {
        pain: "AI assistants can't recommend a business they can't read.",
        fix: "The free score checks exactly what assistants need — crawlability, structured data, an llms.txt file — and the Complete Audit writes your llms.txt for you, ready to upload.",
      },
      {
        pain: "SEO agencies charge $1,000+/month and hand you homework.",
        fix: "The $49 audit crawls up to 120 pages and returns written solutions: ready-to-paste page titles and meta descriptions for your weakest pages, plus a 30-day plan. On WordPress, apply the fixes with one click.",
      },
      {
        pain: "You fixed it once — then things quietly drift.",
        fix: "Site Monitor re-scores your site every week and emails you the moment your score or AI-findability drops, before your traffic graph shows it.",
      },
    ],
    features: [
      "Free website score in about a minute — no signup",
      "$49 Complete Audit: up to 120 pages, section-by-section",
      "Ready-to-paste titles and meta descriptions per page",
      "Your llms.txt written for you",
      "One-click apply to WordPress (titles + excerpts via WordPress core)",
      "Weekly automatic re-scores with drop alerts",
      "Per-page rewrites: headline, intro, structure, CTA",
      "Reports translatable into 18 languages on demand",
    ],
    faq: [
      {
        q: "Do I need to be technical?",
        a: "No. The audit gives you exact text to paste — page titles and descriptions written out, not recommendations to interpret. If your site runs WordPress, connect it once and apply fixes with one click (we update titles and excerpts through WordPress core; SEO-plugin fields stay yours).",
      },
      {
        q: "What exactly does the $49 audit include?",
        a: "A crawl of up to 120 pages scored across five areas (content depth, headlines, discovery, AI findability, repurposing), page-by-page advice, written title and meta-description fixes, a complete llms.txt file, content-gap analysis, and a 30-day plan. It arrives as a web report you can print or translate.",
      },
      {
        q: "What if the audit can't crawl my site?",
        a: "Then you don't pay for it — we don't keep money for reports we couldn't produce. That's written into our refund policy.",
      },
    ],
    ctaSecondary: { href: "/tools/website-score", label: "Score your website free" },
    closing: {
      title: "See your score first",
      sub: "The free checker grades your website's content and AI-findability in about a minute — no signup.",
      href: "/tools/website-score",
      label: "Check my website free",
    },
  },
  writers: {
    name: "Writers & Newsletter Authors",
    slug: "writers",
    headline: "You've already written the video. Let it narrate itself.",
    sub: "Paste an article URL and Virafold turns it into a narrated video with AI visuals and captions — plus the thread, carousel, and social posts to go with it. Video reach for people who write, without a camera or a microphone.",
    pains: [
      {
        pain: "Video reach dwarfs text reach — but you write, you don't film.",
        fix: "Your article becomes a narrated, captioned video with AI-generated visuals per section. No camera, no mic, no editing software — you approve it in the browser.",
      },
      {
        pain: "Rewriting one essay into ten posts is a day of drudgery.",
        fix: "One URL becomes a thread, a carousel, a LinkedIn post, and a newsletter recap — in your voice, with your banned words enforced and your CTA attached.",
      },
      {
        pain: "Headlines decide everything, and you're guessing.",
        fix: "A deterministic hook analyzer scores your headlines with reasons, and A/B testing lets real views — not opinions — pick the winner.",
      },
    ],
    features: [
      "Paste an article URL — or the text itself — as the source",
      "Narrated videos: AI voiceover, per-section visuals, captions",
      "Optional voice cloning from a 10-minute sample",
      "Thread, carousel, LinkedIn post, newsletter from one piece",
      "Hook scoring on every generated title",
      "Evergreen recycling keeps your best pieces circulating",
      "Owned email list with newsletter broadcasts",
    ],
    faq: [
      {
        q: "Do I have to record anything?",
        a: "No. The narration is generated — a natural stock voice by default, or a clone of your own voice from a 10-minute sample if you want the video to sound like you.",
      },
      {
        q: "Will the posts sound like me?",
        a: "Your brand-voice profile — tone, audience, banned words, signature, CTA — steers every generation, and you approve everything before it ships.",
      },
      {
        q: "My posts are paywalled — can I still use them?",
        a: "Yes. Instead of a URL, paste the text directly. It's treated exactly like a transcript and drives the same video and asset generation.",
      },
    ],
    ctaSecondary: { href: "/tools/hook-analyzer", label: "Score a headline free" },
    closing: {
      title: "Test it on your best headline",
      sub: "The free hook analyzer scores any headline in seconds and tells you why — no signup.",
      href: "/tools/hook-analyzer",
      label: "Analyze my headline free",
    },
  },
  saas: {
    name: "B2B SaaS Teams",
    slug: "saas",
    headline: "Every webinar dies after the replay link. Make it a month of pipeline.",
    sub: "Your team already records webinars, demos, and founder conversations. Virafold turns each one into LinkedIn posts, captioned clips, a nurture email, and a thread — approval-gated, in your brand voice, with a signed record of how every asset was made.",
    pains: [
      {
        pain: "Marketing sits on hours of webinars and demos that never ship anywhere.",
        fix: "One upload becomes captioned vertical clips, LinkedIn-native posts, a newsletter, and a thread — the whole distribution set from one recording.",
      },
      {
        pain: "Brand and legal review can't chase ten drafts across ten tools.",
        fix: "Nothing publishes without approval. Shareable review links let stakeholders approve or request changes without a login, policy lint flags risky wording before it ships, and every asset carries a signed provenance manifest with its edit trail.",
      },
      {
        pain: "Founder-led content stalls because founders don't have time.",
        fix: "The founder records once — a podcast appearance, an internal talk. Brand voice and banned words keep the output on-message, and the scheduler ships it over weeks.",
      },
    ],
    features: [
      "Ingest webinars, demos, interviews — video or audio, up to 200 MB",
      "LinkedIn-native posts synthesized from the recording",
      "Captioned vertical clips for Shorts and TikTok",
      "Approval workflow with shareable, no-login review links",
      "Policy lint on wording before anything ships",
      "Signed provenance manifest (C2PA-shaped) on every asset",
      "Brand voice: tone, banned words, CTA enforced per generation",
      "Weekly brief: winners, queue, results — forwardable as-is",
    ],
    faq: [
      {
        q: "How does review and approval work?",
        a: "Every generated asset sits in review until a human approves it. You can approve in the dashboard or send a review link that lets a stakeholder approve or request changes without an account. The decision trail is signed into the asset's provenance record.",
      },
      {
        q: "Can it keep our messaging compliant?",
        a: "It enforces your rules mechanically: banned words and phrases never survive generation, policy lint flags risky wording, and nothing publishes without approval. It's a control layer for your review process — not a substitute for your legal team.",
      },
      {
        q: "What does it integrate with?",
        a: "Any recording from any tool — export from Zoom, Riverside, Teams, or a phone and upload it. Finished assets publish through connected accounts or export as ready-to-post packs for the tools you already use.",
      },
    ],
    ctaSecondary: { href: "/tools/website-score", label: "Score your marketing site free" },
    closing: {
      title: "Start with your marketing site",
      sub: "The free website score grades your content depth and AI-findability in about a minute — the same analysis buyers' AI assistants effectively run on you.",
      href: "/tools/website-score",
      label: "Score our site free",
    },
  },
  "podcast-guests": {
    name: "Podcast Guests",
    slug: "podcast-guests",
    headline: "You did the interview. Now get the reach.",
    sub: "The show posts one link and moves on. The $29 Episode Kit turns your appearance into captioned clips of your best moments, chapters, show notes, a thread, and a newsletter — with your CTA on every asset. One-off, no subscription.",
    pains: [
      {
        pain: "Your appearance disappears from feeds within a day.",
        fix: "One kit yields weeks of material: captioned clips of your strongest exchanges, a thread of your key points, a quote carousel, and a newsletter recap.",
      },
      {
        pain: "The show's clips serve the show — not you.",
        fix: "Your kit is generated in your brand voice with your call-to-action attached, pointing people at your work, not just the episode.",
      },
      {
        pain: "You guest a few times a month — a subscription is overkill.",
        fix: "The Episode Kit is a $29 one-off that adds one project to your account. The free plan already includes one project a month, so occasional guests may not need to pay at all.",
      },
    ],
    features: [
      "One-off $29 — no subscription required",
      "Captioned vertical clips of your best moments",
      "Chapters and show notes from the transcript",
      "Thread + quote carousel + newsletter recap",
      "Your CTA and voice profile on every asset",
      "A media-kit page with your rates, for booking more shows",
    ],
    faq: [
      {
        q: "What do I need to get started?",
        a: "The episode itself — ask the host for the recording (most happily share it), or paste the transcript if that's what you have. Audio-only works for all text assets; video additionally unlocks rendered clips.",
      },
      {
        q: "I host a show — can I offer kits to my guests?",
        a: "Yes, and it's a strong booking pitch: run the guest's episode through your account and send them their assets via a no-login review link. Each Episode Kit adds one project, so buy one per guest episode — or a monthly plan if you publish weekly.",
      },
      {
        q: "How fast is it?",
        a: "Transcription and asset generation run in minutes; rendered clips take a few minutes more. Same-day posting after your episode drops is realistic.",
      },
    ],
    ctaSecondary: { href: "/pricing", label: "See the $29 Episode Kit" },
    closing: {
      title: "One appearance, weeks of content",
      sub: "Sign up free, upload your episode, and see the assets before you spend anything — the first project is on us.",
      href: "/signup",
      label: "Start with my episode",
    },
  },
};

export function generateStaticParams() {
  return Object.keys(PERSONAS).map((persona) => ({ persona }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ persona: string }>;
}): Promise<Metadata> {
  const { persona } = await params;
  const p = PERSONAS[persona];
  if (!p) return {};
  const title = `Virafold for ${p.name} — ${p.headline}`;
  return {
    title,
    description: p.sub,
    alternates: { canonical: `/for/${p.slug}` },
    openGraph: {
      type: "website",
      url: `https://virafold.ai/for/${p.slug}`,
      siteName: "Virafold",
      title,
      description: p.sub,
    },
  };
}

export default async function PersonaPage({
  params,
}: {
  params: Promise<{ persona: string }>;
}) {
  const { persona } = await params;
  const p = PERSONAS[persona];
  if (!p) notFound();

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navbar />
      <main className="pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm font-medium text-neon-purple mb-3">
            Virafold for {p.name}
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold text-foreground leading-tight mb-4">
            {p.headline}
          </h1>
          <p className="text-lg text-cyber-muted leading-relaxed mb-8">{p.sub}</p>

          <div className="flex flex-wrap gap-3 mb-14">
            <Link
              href="/signup"
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Start free — no card required
            </Link>
            <Link
              href={p.ctaSecondary?.href ?? "/audit"}
              className="px-6 py-3 rounded-xl border border-cyber-border text-foreground text-sm hover:border-neon-purple/50 transition-colors"
            >
              {p.ctaSecondary?.label ?? "Run the free channel audit"}
            </Link>
          </div>

          <div className="space-y-4 mb-14">
            {p.pains.map((item) => (
              <div
                key={item.pain}
                className="bg-cyber-card border border-cyber-border rounded-xl p-5"
              >
                <p className="text-sm font-semibold text-foreground mb-1.5">{item.pain}</p>
                <p className="text-sm text-cyber-muted leading-relaxed">{item.fix}</p>
              </div>
            ))}
          </div>

          <h2 className="text-xl font-bold text-foreground mb-4">
            What {p.name.toLowerCase()} get out of the box
          </h2>
          <ul className="grid sm:grid-cols-2 gap-2.5 mb-14">
            {p.features.map((f) => (
              <li key={f} className="flex gap-2 text-sm text-cyber-muted">
                <Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> {f}
              </li>
            ))}
          </ul>

          <h2 className="text-xl font-bold text-foreground mb-4">Common questions</h2>
          <div className="space-y-4 mb-14">
            {p.faq.map((f) => (
              <div key={f.q} className="bg-cyber-card border border-cyber-border rounded-xl p-5">
                <p className="text-sm font-semibold text-foreground mb-1.5">{f.q}</p>
                <p className="text-sm text-cyber-muted leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>

          <div className="bg-gradient-to-r from-neon-purple/10 to-electric-blue/10 border border-neon-purple/30 rounded-xl p-6 text-center">
            <p className="text-lg font-semibold text-foreground mb-2">
              {p.closing?.title ?? "See it on your own channel first"}
            </p>
            <p className="text-sm text-cyber-muted mb-4">
              {p.closing?.sub ?? "The free audit grades your last 25 videos in 20 seconds — no signup."}
            </p>
            <Link
              href={p.closing?.href ?? "/audit"}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {p.closing?.label ?? "Audit my channel free"} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  readTime: string;
  date: string;
  gradient: string;
  featured: boolean;
  content: string[];
}

export interface Project {
  id: string;
  title: string;
  status: "uploading" | "processing" | "review" | "published" | "rejected";
  progress: number;
  assetsReady: number;
  assetsTotal: number;
  eta: string;
  createdAt: string;
  fileName?: string;
  fileSize?: string;
}

export interface Asset {
  id: string;
  projectId: string;
  name: string;
  type: string;
  views: string;
  status: "live" | "sent" | "draft" | "scheduled";
  liked: boolean;
  content?: string;
  /** Evergreen assets are automatically re-queued after each publish. */
  evergreen?: boolean;
  /** Set when this asset is one variant of an A/B hook test. */
  abGroup?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: "info" | "success" | "warning";
}

/**
 * Per-user brand-voice profile. Every field is optional free text; an empty
 * profile leaves generation unchanged. Applied by both the deterministic
 * engine and the LLM path so output "sounds like" the creator.
 */
export interface BrandVoice {
  tone: string;
  audience: string;
  cta: string;
  hashtags: string;
  bannedWords: string;
  signature: string;
  emojis: boolean;
}

export const DEFAULT_VOICE: BrandVoice = {
  tone: "",
  audience: "",
  cta: "",
  hashtags: "",
  bannedWords: "",
  signature: "",
  emojis: true,
};

export const blogPosts: BlogPost[] = [
  {
    slug: "podcast-to-30-posts-exact-pipeline",
    title: "How One 45-Minute Podcast Becomes 30 Posts: The Exact Pipeline",
    excerpt:
      "Not clips of the same moment posted five times — thirty distinct pieces, extracted from what you actually said. Here is every step, in order, with the reasoning behind it.",
    category: "Repurposing",
    readTime: "6 min read",
    date: "Sep 22, 2026",
    gradient: "from-neon-purple to-electric-blue",
    featured: true,
    content: [
      "Most creators think repurposing means cutting a long video into short clips. That's step three of seven. The real pipeline starts before the cut and ends after the post — and every stage exists because skipping it produces content that looks recycled instead of made. This is the exact pipeline we run, stage by stage.",
      "## Stage 1: Transcribe with word-level timestamps",
      "Everything downstream depends on knowing not just what was said, but exactly when. Word-level timestamps are what let a clip start on the first word of a strong sentence instead of half a breath late — the difference between a hook that lands and one that gets swiped past. If your transcription tool only gives you paragraphs, you're building on sand.",
      "Speaker labels matter too. In an interview, the pipeline needs to know which voice said the quotable line, because a caption that attributes it wrong reads as sloppy — and clips that cut mid-speaker-turn feel broken.",
      "## Stage 2: Find the moments your audience already voted for",
      "Generic AI clipping tools score moments against an average of what goes viral for everyone. But your channel isn't average. The stronger approach: look at what has already performed for you — your top posts, your audit history — and find the moments in the new recording that match your proven patterns. Evidence beats vibes. When a tool tells you which of your past winners a clip resembles, you can sanity-check its judgment instead of trusting a black box.",
      "## Stage 3: Cut vertical clips with captions burned in",
      "The majority of short-form viewing happens with sound off, at least at first. Captions aren't an accessibility bonus — they're the primary channel. Burn them in, size them for a phone held at arm's length, and keep each caption chunk short enough to read in one glance. Position matters: captions sitting over a platform's UI elements get covered by buttons.",
      "## Stage 4: Write the text formats from the transcript, not about it",
      "A thread is not a description of your episode — it's the episode's best argument, restructured for the feed. Same for carousels and newsletters. Pull the actual sentences, the actual numbers, the actual claims from the transcript. Text formats built from summaries sound like summaries; text formats built from the source sound like you.",
      "One 45-minute recording typically yields: eight to twelve clips, one thread, one carousel, one newsletter section, and a handful of standalone quote posts. That's the '30 posts' — thirty distinct pieces with different hooks, not one moment wearing thirty outfits.",
      "## Stage 5: Approve everything before it ships",
      "This is the stage automation-first tools skip, and it's the one that keeps your feed yours. Every asset gets a human look — yours — before it publishes. Regenerate what misses. The goal isn't to remove your judgment from the process; it's to spend your judgment on approving instead of producing.",
      "## Stage 6: Schedule against your data, not a best-practices chart",
      "Generic 'best time to post' charts describe an average audience in an average timezone. Your analytics describe yours. Schedule against your own engagement history where you have it, spread the thirty posts across a month, and let evergreen winners recycle after their first run.",
      "## Stage 7: Feed the results back",
      "The pipeline improves only if performance data returns to it. Track which hooks won, promote those into the examples your next generation draws from, and let losing patterns fade. This is the compounding step: month two's content starts from month one's winners.",
      "You can run this pipeline manually with a transcription tool, a spreadsheet, and discipline — creators did exactly that for years. Virafold runs all seven stages from one upload, with you at the approval gate. Either way, the pipeline is the point: one recording already contains the month of content. The work is extraction, not creation.",
    ],
  },
  {
    slug: "why-good-videos-die-audit-patterns",
    title: "Why Good Videos Die: 5 Patterns From Real Channel Audits",
    excerpt:
      "The ideas are almost never the problem. Five failure patterns that show up over and over when channels get audited — and the specific fix for each one.",
    category: "Growth",
    readTime: "6 min read",
    date: "Sep 16, 2026",
    gradient: "from-fuchsia-500 to-neon-purple",
    featured: false,
    content: [
      "Run enough channel audits and a strange pattern emerges: the channels that struggle rarely have an idea problem. The topics are fine. The knowledge is real. What kills the videos is almost always mechanical — and mechanical problems have mechanical fixes. Here are the five patterns that show up most, and what to do about each.",
      "## Pattern 1: The hook arrives too late",
      "The most common failure by a wide margin. The video's genuinely interesting claim shows up at the ninety-second mark, after an introduction, a channel plug, and a table of contents. Short-form viewers decide in under three seconds; long-form viewers give you maybe fifteen. The fix is brutal and simple: find the most interesting sentence in your script and make it the first sentence. Everything you were going to say before it becomes context you deliver after.",
      "## Pattern 2: Winning formats get abandoned",
      "Channels drift. A creator finds a format that works, gets bored of it before the audience does, and quietly stops making it. The audit sees what the creator doesn't: the abandoned format is often still their best performer per video. Your boredom is not a signal; your retention data is. Keep the winning format and feed your need for novelty inside it.",
      "## Pattern 3: Posting rhythm collapses quietly",
      "Consistency sounds like advice for beginners, but the data is stubborn: gaps hurt, and they hurt more than most creators think, because platforms reward channels that audiences return to on a rhythm. The fix isn't heroic effort — it's a buffer. A backlog of ready-to-post content, built from long-form you've already recorded, absorbs the weeks when life happens.",
      "## Pattern 4: Titles describe instead of provoke",
      "A title that accurately describes the video is doing half a job. Its whole job is to make the click feel necessary. Questions open loops. Numbers promise concrete value. Words like 'never', 'mistake', and 'why' signal stakes. This is measurable — score your last ten titles honestly and most channels find their weakest performers had the most polite titles.",
      "## Pattern 5: One platform carries everything",
      "When every view comes from one algorithm, every algorithm change is an existential event. The channels that survive shifts are the ones whose content lives in three or four places — the video on YouTube, the argument as a thread, the framework as a carousel, the story in a newsletter. Distribution is insurance, and repurposing is the cheapest premium you'll ever pay for it.",
      "None of these patterns requires talent to fix. They require seeing your channel the way the data sees it — which is exactly what an audit is for. Ours is free, takes about twenty seconds, and names every factor it grades: virafold.ai/audit. Whatever tool you use, audit before you overhaul. Fixing the wrong problem is the most expensive mistake in content.",
    ],
  },
  {
    slug: "faceless-youtube-2026-what-works",
    title: "Faceless YouTube in 2026: 7 Things That Work and 3 That Never Did",
    excerpt:
      "Faceless channels are a strategy, not a shortcut. What's actually working in 2026, what stopped working, and what was always a myth.",
    category: "Growth",
    readTime: "7 min read",
    date: "Sep 10, 2026",
    gradient: "from-electric-blue to-cyan-500",
    featured: false,
    content: [
      "Faceless content has outgrown its reputation. What started as a workaround for camera-shy creators is now a deliberate strategy: channels built on knowledge, voice, and format rather than a person's on-screen presence. But the space is crowded with advice written in 2022. Here's an honest 2026 accounting — seven things that work, three that never really did.",
      "## Works: owning a niche's questions, not its name",
      "The faceless channels growing in 2026 don't cover 'finance' — they answer the forty specific questions their audience actually types into search bars. Niche ownership means when someone asks that question, your video is the answer. Breadth is the enemy: a channel that answers one category of question deeply beats a channel that gestures at a topic broadly.",
      "## Works: voice as the face",
      "Without a face on screen, your voice carries identity. That doesn't mean radio-announcer polish — it means consistency. Same energy, same pacing, same way of explaining things. AI narration has gotten good enough to be an option here, including cloning your own voice so scale doesn't cost you identity. What matters is that episode forty sounds like episode four.",
      "## Works: captions doing the performing",
      "On-screen text is the faceless channel's body language. Bold captions, timed word-by-word, carry emphasis the way a raised eyebrow would. Channels that treat captions as an afterthought — small, static, occasionally wrong — are leaving their main performance channel unused.",
      "## Works: format as brand",
      "Viewers of faceless channels return for the format the way they'd return for a person. A recognizable structure — how you open, how you build, how you land — is your substitute for familiarity of face. Pick a structure and let it compound.",
      "## Works: volume with a quality gate",
      "Faceless economics allow more output, and volume genuinely helps — but only above a quality floor. The channels that win pair scaled production with a human approval step. Publish more, but look at everything before it goes out.",
      "## Works: repurposing one source everywhere",
      "The strongest faceless operations don't create per-platform; they extract per-platform from one strong source. One script becomes the YouTube video, the Shorts, the thread, the newsletter. Multiplying surfaces without multiplying recording time is the entire economic advantage of going faceless.",
      "## Works: letting your data pick your topics",
      "Your published catalog is a topic-testing engine. The faceless channels compounding in 2026 read their own analytics before brainstorming: what over-performed, which hooks earned their click, what the audience asked in comments. Then they make more of that.",
      "## Never worked: full automation with no human in the loop",
      "The 'set it and forget it' channel — auto-generated, auto-posted, never reviewed — has been promised since 2022 and has quietly failed the whole time. Platforms have gotten better at recognizing effortless content, and audiences were always better at it than platforms. Automation that removes production work: yes. Automation that removes judgment: no.",
      "## Never worked: stolen or 'freebooted' content",
      "Re-uploading other people's material with a filter over it isn't a faceless strategy, it's a copyright strike on a timer. It never built a durable channel and it never will.",
      "## Never worked: chasing every trend outside your niche",
      "Trend-hopping buys spikes and costs subscribers, because the people a trend brings in didn't come for what you actually make. A trend is worth riding only when it intersects your niche — then it's a gift.",
      "The honest summary: faceless works in 2026 the way any channel works — knowledge, consistency, format, and feedback loops — minus the camera and plus an extraction pipeline. The camera was never the hard part.",
    ],
  },
  {
    slug: "llms-txt-ai-assistants-guide",
    title: "Why AI Assistants Never Recommend Your Site — and the 20-Minute llms.txt Fix",
    excerpt:
      "People increasingly ask AI assistants instead of search engines. Most websites are invisible to that channel. One small text file is the highest-leverage fix available.",
    category: "AI Search",
    readTime: "5 min read",
    date: "Sep 4, 2026",
    gradient: "from-amber-500 to-fuchsia-500",
    featured: false,
    content: [
      "A growing share of discovery now happens inside AI assistants. Someone asks for 'a tool that turns podcasts into clips' or 'a good print shop near Columbia' — and an AI answers with specific recommendations. If your site isn't legible to those systems, you're not losing a ranking; you're absent from the conversation entirely.",
      "The uncomfortable part: most websites are built for human eyes and Google's crawler, in that order, and for AI readers not at all. Navigation lives in JavaScript, the value proposition lives in a hero image, and the pricing is a screenshot. An AI system reading that page learns almost nothing it can confidently repeat.",
      "## What llms.txt actually is",
      "llms.txt is a plain-text file at your site's root — the same idea as robots.txt, but instead of telling crawlers what they may read, it tells AI systems what your site is. A heading with your name. A paragraph, in plain language, saying what you offer and for whom. A short list of your most important pages with one-line descriptions. That's the whole format.",
      "It works because it removes inference. Instead of an AI guessing your purpose from a marketing headline, you state it in the exact shape language models consume best: clear, factual, structured text.",
      "## The 20-minute version",
      "Write it like you'd brief a new employee. First line: your site's name as a heading. Then one paragraph: what you do, who it's for, what makes it different — no slogans, no adjectives doing heavy lifting. Then a bulleted list: your five to ten most important pages, each with a one-sentence description of what a visitor finds there. Save it as llms.txt, upload it to your site root, done.",
      "Two rules keep it useful. Be factual — an AI repeating your hype to a user erodes trust in both of you. And keep it current — a stale llms.txt describing products you no longer sell is worse than none.",
      "## While you're at it: the supporting cast",
      "llms.txt works best alongside the structure AI readers already use. Structured data (JSON-LD) tells machines what type of thing each page is. Clear heading hierarchies make your pages skimmable to a parser. Real meta descriptions give summarizers something accurate to summarize. None of this is exotic — it's the same hygiene good SEO wanted, now with a second audience reading it.",
      "## How to check where you stand",
      "We built a free scanner that grades exactly this: whether your site has llms.txt, structured data, readable headings, and the content depth AI systems cite — alongside the classic discovery basics. It reads up to eight pages and names every factor it scores: virafold.ai/tools/website-score. Twenty seconds, no signup.",
      "Search engines took a decade to become the front door of the internet. AI assistants are doing it faster, and almost nobody has furnished their site for the new visitor. A text file and twenty minutes puts you ahead of most of the web — that ratio of effort to advantage doesn't appear often.",
    ],
  },
  {
    slug: "build-10k-faceless-youtube-channel",
    title: "How to Build a $10K/mo Faceless YouTube Channel in 2025",
    excerpt:
      "The complete blueprint for launching a faceless channel — from niche selection to monetization strategies that actually work.",
    category: "Growth",
    readTime: "8 min read",
    date: "Apr 14, 2025",
    gradient: "from-neon-purple to-electric-blue",
    featured: true,
    content: [
      "Faceless YouTube channels are one of the most lucrative opportunities in the creator economy right now. With AI tools making content creation faster and cheaper than ever, you can build a channel that generates $10K or more per month — without ever showing your face.",
      "The first step is niche selection. The best niches for faceless content combine high CPM (cost per thousand impressions) with evergreen topics. Finance, technology, health, and self-improvement consistently outperform entertainment and lifestyle niches in terms of revenue per view.",
      "Once you've picked your niche, you need a content engine. This is where AI repurposing comes in. Instead of creating every piece of content from scratch, you start with one long-form piece — a podcast episode, a deep-dive video, or a course module — and let AI break it down into dozens of short-form assets.",
      "Your content stack should include: YouTube Shorts (for discovery), long-form videos (for watch time and ad revenue), community posts (for engagement), and an email list (for ownership). Each piece of content feeds into the next, creating a flywheel effect.",
      "For monetization, don't rely solely on AdSense. Layer in affiliate marketing (especially for software and tools), digital products (templates, guides, courses), and sponsorships. A faceless channel with 50K subscribers can easily generate $10K/mo from these combined sources.",
      "The key to scaling is systems. Use tools like Virafold to automate your content pipeline. Upload once, get 30+ assets. Schedule them across platforms. Track what works. Double down on winners. This is how faceless creators are building six-figure businesses in 2025.",
    ],
  },
  {
    slug: "ai-content-repurposing-guide",
    title: "AI Content Repurposing: The Ultimate Guide",
    excerpt:
      "Turn one piece of content into 30+ assets automatically. Here's exactly how the AI pipeline works behind the scenes.",
    category: "AI Tools",
    readTime: "12 min read",
    date: "Apr 10, 2025",
    gradient: "from-electric-blue to-cyan-500",
    featured: true,
    content: [
      "Content repurposing is the strategy of taking one piece of content and transforming it into multiple formats for different platforms. With AI, this process that used to take hours can now happen in minutes.",
      "The AI repurposing pipeline starts with transcription. Advanced speech-to-text models like Whisper can transcribe hours of audio with near-perfect accuracy, complete with speaker diarization and timestamp alignment.",
      "Next comes content analysis. AI models score each segment of your content for viral potential, identifying hooks, quotable moments, emotional peaks, and knowledge bombs. These segments become the foundation for your short-form clips.",
      "The clipping engine then cuts your content at optimal points. Unlike manual editing where you might create 3-5 clips from an hour of content, AI can identify 15-20 viable clip opportunities, each with strong opening hooks and satisfying conclusions.",
      "Visual enhancement is where the magic happens. AI adds dynamic captions (not just subtitles — animated, highlighted keyword captions), relevant B-roll footage, motion graphics, and branded templates. The result looks professionally produced.",
      "Finally, the distribution layer handles platform-specific formatting. A YouTube Short has different specs than a TikTok or Instagram Reel. The AI adjusts aspect ratios, caption placement, and even pacing to match each platform's algorithm preferences.",
      "The result? One 45-minute podcast episode becomes: 8-12 short-form clips, 2-3 carousel posts, 1 newsletter edition, 5-8 social media posts, and 1 blog article. That's 30+ pieces of content from a single recording session.",
    ],
  },
  {
    slug: "faceless-content-vs-personal-brands",
    title: "Why Faceless Content Outperforms Personal Brands",
    excerpt:
      "Data-backed analysis showing why faceless channels grow faster and monetize better than personality-driven content.",
    category: "Strategy",
    readTime: "6 min read",
    date: "Apr 7, 2025",
    gradient: "from-cyan-500 to-emerald-500",
    featured: false,
    content: [
      "There's a growing body of evidence that faceless content channels outperform personality-driven channels in several key metrics. Let's look at the data.",
      "First, production speed. A faceless creator can publish 5-10x more content than a face-on-camera creator in the same time period. No makeup, no lighting setup, no multiple takes. Just script, produce, publish.",
      "Second, scalability. Personal brands hit a ceiling — you can only be in so many videos. Faceless channels can scale to multiple sub-channels, each targeting different niches, all running simultaneously.",
      "Third, sellability. A faceless channel is a true business asset. It can be sold, licensed, or operated by a team without depending on one person's likeness. This makes it significantly more valuable as an exit opportunity.",
      "The data shows that the top 100 faceless YouTube channels grew an average of 340% faster than personality-driven channels in the same niches over the past 12 months. Their CPMs are 23% higher on average because they tend to operate in high-value niches.",
      "The bottom line: faceless content isn't just a trend — it's a more scalable, more profitable, and more sustainable business model for creators who want to build real wealth.",
    ],
  },
  {
    slug: "creators-guide-passive-income",
    title: "The Creator's Guide to Passive Income",
    excerpt:
      "How to build multiple revenue streams from a single content source using AI repurposing and automation.",
    category: "Monetization",
    readTime: "10 min read",
    date: "Apr 3, 2025",
    gradient: "from-amber-500 to-orange-500",
    featured: false,
    content: [
      "Passive income for creators isn't truly passive — but it can be incredibly leveraged. The key is building systems where one hour of work generates returns for months or years.",
      "The foundation is content that compounds. Evergreen videos on YouTube continue generating ad revenue indefinitely. A video about 'how to invest your first $1000' uploaded today will still get views in 2027.",
      "Layer in digital products. Take your best-performing content and package it into a course, ebook, or template pack. If your faceless finance shorts are getting millions of views, a comprehensive budgeting template pack at $27 will sell consistently.",
      "Affiliate marketing is the multiplier. Every piece of content is an opportunity to recommend tools and services. A single well-placed affiliate link in a viral video description can generate hundreds of dollars per day.",
      "Email is the ownership layer. Social platforms can change algorithms overnight. An email list is yours. Build it from day one, nurture it with repurposed content, and monetize it with product launches and affiliate offers.",
      "The automation stack ties it all together. Use AI repurposing to keep content flowing, email automation to nurture subscribers, and analytics to identify your highest-ROI content. This is how creators build $10K-$50K/mo in semi-passive income.",
    ],
  },
  {
    slug: "7-ai-tools-faceless-creators",
    title: "7 AI Tools Every Faceless Creator Needs",
    excerpt:
      "From ElevenLabs voice cloning to automated thumbnail generators — the essential AI toolkit for content creators.",
    category: "AI Tools",
    readTime: "9 min read",
    date: "Mar 22, 2025",
    gradient: "from-violet-500 to-purple-500",
    featured: false,
    content: [
      "The faceless creator toolkit has evolved dramatically in 2025. Here are the 7 AI tools that every serious faceless creator should have in their stack.",
      "1. Virafold — for content repurposing. Turn one long-form video into 30+ assets automatically. This is the backbone of any faceless content operation.",
      "2. ElevenLabs — for AI voice generation. Create natural-sounding voiceovers in any style without recording yourself. Their voice cloning feature means you can create a consistent brand voice.",
      "3. Midjourney/DALL-E — for thumbnail and visual generation. Create eye-catching thumbnails and visual assets that drive clicks without needing photography skills.",
      "4. Descript — for script writing and editing. Write scripts with AI assistance and edit audio/video by editing text. Perfect for creators who think in words rather than timelines.",
      "5. Canva AI — for carousel and graphic design. Automated layout suggestions, brand kit management, and batch creation make it easy to produce professional graphics at scale.",
      "6. Opus Clip — for identifying viral moments. AI analyzes your long-form content and scores segments by viral potential, helping you prioritize which clips to publish first.",
      "7. Buffer/Hootsuite — for scheduling and analytics. Automated posting across platforms with AI-powered optimal timing suggestions. Track what works and scale your winners.",
    ],
  },
  {
    slug: "linkedin-carousel-strategy",
    title: "LinkedIn Carousel Strategy That Gets 10x Saves",
    excerpt:
      "The exact formula for creating carousel posts that go viral and drive leads — extracted from 500+ top-performing posts.",
    category: "Strategy",
    readTime: "5 min read",
    date: "Mar 18, 2025",
    gradient: "from-blue-500 to-indigo-500",
    featured: false,
    content: [
      "LinkedIn carousels are the highest-engagement format on the platform, generating 3-5x more saves and shares than text posts. Here's the formula we've extracted from analyzing 500+ top-performing carousels.",
      "Slide 1: The Hook. Your first slide must create curiosity or promise value. The best-performing hooks follow the pattern: '[Number] [Things] that [Desirable Outcome].' Example: '7 pricing mistakes that cost SaaS founders $1M+.'",
      "Slides 2-8: The Value. Each slide should deliver one atomic insight. Use large text (minimum 24pt), minimal words (under 30 per slide), and consistent branding. Include data points, frameworks, or counterintuitive takes.",
      "Slide 9: The Summary. Recap all points in a single slide. This becomes the most-saved slide because it's a reference card. Make it visually clean and screenshot-worthy.",
      "Slide 10: The CTA. Tell people what to do next. The highest-converting CTAs are: 'Save this for later' (drives saves), 'Tag someone who needs this' (drives reach), and 'Follow for more' (drives followers).",
      "Design tips: Use dark backgrounds (they stand out in the feed), gradient accents (they catch the eye during scroll), and consistent typography. Your carousel should be instantly recognizable as yours.",
    ],
  },
  {
    slug: "pricing-digital-products",
    title: "How to Price Your Digital Products for Maximum Revenue",
    excerpt:
      "Pricing psychology and data-driven strategies for courses, memberships, and digital downloads.",
    category: "Monetization",
    readTime: "8 min read",
    date: "Mar 12, 2025",
    gradient: "from-emerald-500 to-teal-500",
    featured: false,
    content: [
      "Pricing is the single biggest lever for revenue growth in digital products. A 10% price increase often translates to a 25-50% profit increase because your costs stay the same.",
      "The anchoring principle is your best friend. Always show a higher-priced option first. If you sell a $97 course, show a $297 premium bundle above it. The $97 suddenly feels like a bargain.",
      "Use the Rule of 3: offer three tiers. Basic ($X), Standard ($3X), and Premium ($5X). Most buyers choose the middle option, which is exactly where you want them. This is called the compromise effect.",
      "End prices in 7. Studies consistently show that prices ending in 7 outperform those ending in 9 or 0. $47 converts better than $49. $197 converts better than $199. It's subtle but significant at scale.",
      "Bundle aggressively. A course + template pack + community access at $197 converts better than the course alone at $97. You're not raising the price — you're increasing the perceived value faster than you're increasing the cost.",
      "Test seasonally. Black Friday, New Year, and September (back-to-school for adult learners) are peak buying seasons. Plan your highest-priced launches around these windows when buying intent is naturally elevated.",
    ],
  },
];

export const defaultProjects: Project[] = [
  {
    id: "proj-1",
    title: "Episode 52 — The Future of AI Agents",
    status: "processing",
    progress: 42,
    assetsReady: 3,
    assetsTotal: 12,
    eta: "~45 min",
    createdAt: "2025-04-16T10:30:00Z",
    fileName: "ep52-ai-agents.mp4",
    fileSize: "1.2 GB",
  },
  {
    id: "proj-2",
    title: "Episode 51 — Building in Public",
    status: "review",
    progress: 100,
    assetsReady: 10,
    assetsTotal: 10,
    eta: "Awaiting approval",
    createdAt: "2025-04-14T09:15:00Z",
    fileName: "ep51-building-public.mp4",
    fileSize: "890 MB",
  },
  {
    id: "proj-3",
    title: "Episode 50 — Monetize Your Podcast",
    status: "published",
    progress: 100,
    assetsReady: 14,
    assetsTotal: 14,
    eta: "Published Apr 12",
    createdAt: "2025-04-10T14:00:00Z",
    fileName: "ep50-monetize.mp4",
    fileSize: "1.4 GB",
  },
  {
    id: "proj-4",
    title: "Episode 49 — Audience Growth Hacks",
    status: "published",
    progress: 100,
    assetsReady: 11,
    assetsTotal: 11,
    eta: "Published Apr 8",
    createdAt: "2025-04-06T11:45:00Z",
    fileName: "ep49-growth.mp4",
    fileSize: "1.1 GB",
  },
];

export const defaultAssets: Asset[] = [
  { id: "a-1", projectId: "proj-3", name: "AI Agents Short #1", type: "YouTube Short", views: "24.3K", status: "live", liked: false },
  { id: "a-2", projectId: "proj-3", name: "Building in Public Carousel", type: "LinkedIn", views: "8.7K", status: "live", liked: false },
  { id: "a-3", projectId: "proj-3", name: "Podcast Highlight Reel", type: "TikTok", views: "142K", status: "live", liked: true },
  { id: "a-4", projectId: "proj-3", name: "Weekly Newsletter #50", type: "Email", views: "3.2K opens", status: "sent", liked: false },
  { id: "a-5", projectId: "proj-2", name: "Building in Public Short #1", type: "YouTube Short", views: "—", status: "draft", liked: false },
  { id: "a-6", projectId: "proj-2", name: "BIP LinkedIn Carousel", type: "LinkedIn", views: "—", status: "draft", liked: false },
];

export const defaultNotifications: Notification[] = [
  {
    id: "n-1",
    title: "Processing Complete",
    message: "Episode 51 — Building in Public is ready for review.",
    time: "2 hours ago",
    read: false,
    type: "success",
  },
  {
    id: "n-2",
    title: "New Assets Available",
    message: "3 new short-form clips generated for Episode 52.",
    time: "5 hours ago",
    read: false,
    type: "info",
  },
  {
    id: "n-3",
    title: "Publishing Scheduled",
    message: "Episode 50 assets scheduled for auto-publish via Zapier.",
    time: "1 day ago",
    read: true,
    type: "info",
  },
];

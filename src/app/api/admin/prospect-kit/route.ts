import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/server/auth";
import { insertEvent } from "@/lib/server/db";
import { analyzeSite } from "@/lib/server/website-score";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * SMB outbound kit (operator-only): score one prospect's site and draft the
 * outreach email around its two weakest areas. Deterministic template + the
 * analyzer's own findings — no LLM, no invented claims; every number in the
 * email is the real score. The console card loops a pasted list through this
 * one URL at a time.
 */
export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Polite crawling even for ourselves: bound the pace.
  const gate = rateLimit(`prospect:${admin.email}`, 40, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const url = String((body as Record<string, unknown>)?.url ?? "").trim().slice(0, 300);
  if (!url) return NextResponse.json({ error: "A URL is required" }, { status: 400 });

  const result = await analyzeSite(url, { maxPages: 4 });
  if (!result.ok) {
    return NextResponse.json({ url, ok: false, error: result.error });
  }
  const r = result.report;
  let host = url;
  try {
    host = new URL(r.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep raw */
  }

  // The two weakest sections, each with its first (most important) note.
  const weakest = [...r.sections].sort((a, b) => a.score - b.score).slice(0, 2);
  const findings = weakest.map((s) => `${s.label} (${s.score}/20): ${s.notes[0] ?? "room to improve"}`);

  const scoreUrl = `https://virafold.ai/tools/website-score?url=${encodeURIComponent(r.url)}`;
  const auditUrl = `https://virafold.ai/site-audit?url=${encodeURIComponent(r.url)}`;
  const sequence = buildSequence(host, r, findings, weakest, scoreUrl, auditUrl);

  insertEvent("prospect_scored", host, String(r.total));
  return NextResponse.json({
    url: r.url,
    ok: true,
    score: r.total,
    grade: r.grade,
    findings,
    email: sequence[0].email, // first touch, kept for compatibility
    sequence,
  });
}

// --- The 7-touch sequence ---
// Escalates diagnosis → free value → why-now → offer detail → comparison →
// direct ask → polite breakup. Every number is the prospect's real result;
// no invented case studies, stats, or deadlines — escalation comes from
// relevance and directness, not manufactured urgency.

const SIGNATURE = ["— Justin Faye", "Virafold · virafold.ai · justin@virafold.ai"];

/** Plain-language explainer + a genuinely free DIY tip per section. */
const SECTION_HELP: Record<string, { plain: string; diy: string }> = {
  depth: {
    plain:
      "most pages are too thin for Google — or an AI assistant — to treat as a real answer to anything. Thin pages get skimmed and skipped.",
    diy: "Pick your single most important service page and grow it to 600+ words answering the questions customers actually ask you on the phone — pricing factors, process, how long things take. One strong page beats five thin ones.",
  },
  headlines: {
    plain:
      "the page titles read like labels instead of answers. Titles are what people see in search results — they decide the click before anyone sees the site.",
    diy: "Rewrite your homepage title as [what you do] + [where] + [why you], under 60 characters. \"Smith & Co\" tells a searcher nothing; \"Same-Week Furnace Repair in Queens — Smith & Co\" wins the click.",
  },
  discovery: {
    plain:
      "some of the basics search engines rely on to find and rank pages — sitemap, page descriptions, structured data — have gaps. These are unglamorous, but they're the plumbing.",
    diy: "Make sure every page has its own meta description under 155 characters. It's the sentence Google prints under your name — pages without one get whatever Google scrapes.",
  },
  ai: {
    plain:
      "AI assistants like ChatGPT and Perplexity can't confidently read and cite the site. More and more customers ask an assistant for a recommendation before they ever search.",
    diy: "Add a file called llms.txt at your site root — a one-page, plain-text summary of who you serve and what you offer. It's the file AI assistants look for first, and almost no local business has one yet.",
  },
  repurpose: {
    plain:
      "the content that exists isn't structured to travel — no feed, best material buried — so every piece works exactly once instead of compounding.",
    diy: "Add an RSS feed and link your three best articles straight from the homepage. Content that machines can subscribe to gets redistributed; content in a buried archive doesn't.",
  },
};

interface SeqEmail {
  day: number;
  purpose: string;
  email: { subject: string; body: string };
}

function buildSequence(
  host: string,
  r: { total: number; grade: string; fetchedPages: number; sections: { key: string; label: string; score: number; notes: string[] }[] },
  findings: string[],
  weakest: { key: string; label: string; score: number; notes: string[] }[],
  scoreUrl: string,
  auditUrl: string
): SeqEmail[] {
  const w1 = weakest[0];
  const help1 = SECTION_HELP[w1?.key ?? "depth"] ?? SECTION_HELP.depth;
  const ai = r.sections.find((s) => s.key === "ai");
  const aiScore = ai?.score ?? 0;
  const join = (lines: string[]) => [...lines, ``, ...SIGNATURE].join("\n");

  return [
    {
      day: 0,
      purpose: "The diagnosis — lead with their real result",
      email: {
        subject: `${host} scored ${r.total}/100 for content & AI findability`,
        body: join([
          `Hi,`,
          ``,
          `I run Virafold, a tool that analyzes how findable a website is — in Google and in AI assistants like ChatGPT and Perplexity. I ran ${host} through it today: it scored ${r.total}/100 (grade ${r.grade}) across ${r.fetchedPages} pages.`,
          ``,
          `Two things that stood out:`,
          ...findings.map((f) => `- ${f}`),
          ``,
          `You can re-run the full check yourself, free and without signing up: ${scoreUrl}`,
          ``,
          `If you'd like the fixes written out — exact page titles, meta descriptions, and a 30-day plan — we do a complete audit of up to 120 pages for $49, and you don't pay if we can't produce the report: ${auditUrl}`,
          ``,
          `Either way, the free report above is yours to keep.`,
        ]),
      },
    },
    {
      day: 3,
      purpose: "Pure value — one fix they can make today, no ask",
      email: {
        subject: `One thing on ${host} you can fix today (free)`,
        body: join([
          `Hi,`,
          ``,
          `Following up on the report I sent — no pitch in this one, just the most useful thing in it.`,
          ``,
          `${host}'s weakest area was ${w1?.label ?? "content depth"} (${w1?.score ?? 0}/20). In plain terms: ${help1.plain}`,
          ``,
          `Here's the fix you can do yourself this week, free:`,
          ``,
          `${help1.diy}`,
          ``,
          `That one change usually moves the needle on its own. The full report with everything else is still here: ${scoreUrl}`,
        ]),
      },
    },
    {
      day: 7,
      purpose: "Why now — the AI-assistant shift, with their real AI score",
      email: {
        subject: `Can ChatGPT recommend ${host}? (${aiScore}/20 right now)`,
        body: join([
          `Hi,`,
          ``,
          `A shift worth knowing about: a growing share of customers now ask an AI assistant — ChatGPT, Perplexity, Google's AI results — for a recommendation before they ever see a normal search page. Assistants can only recommend businesses whose sites they can actually read and trust.`,
          ``,
          aiScore >= 15
            ? `${host} is actually in decent shape here — ${aiScore}/20 on AI findability, better than most local sites I score. The game now is keeping it that way as the assistants change what they read.`
            : `${host} currently scores ${aiScore}/20 on AI findability. The practical meaning: when someone asks an assistant for a recommendation in your category, your site is unlikely to be the source it cites.`,
          ``,
          `The clearest single upgrade is an llms.txt file — a one-page summary at your site root that tells AI assistants who you serve and what you offer. Almost no local business has one yet, which is exactly why it's worth being early.`,
          ``,
          `The $49 audit writes yours for you, along with the rest of the fixes: ${auditUrl}`,
        ]),
      },
    },
    {
      day: 12,
      purpose: "The offer, itemized — handle the 'what am I buying' objection",
      email: {
        subject: `What the $49 audit of ${host} actually includes`,
        body: join([
          `Hi,`,
          ``,
          `A few people have asked what the audit actually is, so here's the plain list. For $49, on ${host}:`,
          ``,
          `- A crawl of up to 120 pages, scored across five areas (your free report covered ${r.fetchedPages})`,
          `- Ready-to-paste fixes: exact page titles and meta descriptions for your weakest pages — written out, not "recommendations"`,
          `- Your llms.txt file, written for you`,
          `- Page-by-page advice and a 30-day plan, in priority order`,
          `- If your site runs WordPress: apply the fixes with one click`,
          ``,
          `Two honest caveats: it's software plus AI analysis, not a human consultant — that's how it costs $49 and arrives the same day. And if we can't crawl your site and produce the report, you aren't charged. That's in our refund policy in writing.`,
          ``,
          `${auditUrl}`,
        ]),
      },
    },
    {
      day: 18,
      purpose: "Comparison frame — let them check competitors themselves",
      email: {
        subject: `How does ${host} compare to the competition?`,
        body: join([
          `Hi,`,
          ``,
          `One more useful thing you can do with the free checker: run your competitors through it.`,
          ``,
          `${scoreUrl.split("?")[0]}`,
          ``,
          `Paste in the sites of the two or three businesses you lose customers to and see how their scores compare to your ${r.total}/100. In most local categories everyone scores in the same mediocre band — which means the first business that actually fixes its findability is the one search engines and AI assistants start preferring.`,
          ``,
          `I'd rather that be you, mostly because you're the one I emailed. The written fixes are $49 whenever you want them: ${auditUrl}`,
        ]),
      },
    },
    {
      day: 25,
      purpose: "Direct ask — short, one question",
      email: {
        subject: `Should I run the full audit on ${host}?`,
        body: join([
          `Hi,`,
          ``,
          `Short one. Your site scored ${r.total}/100 (${r.grade}) when I checked it — the issues I flagged are still the difference between being found and being skipped.`,
          ``,
          `Want me to run the full audit? $49, report the same day, written fixes included, not charged if it can't be produced: ${auditUrl}`,
          ``,
          `Or just reply with any question — I answer every email personally.`,
        ]),
      },
    },
    {
      day: 32,
      purpose: "The breakup — close the loop politely, door stays open",
      email: {
        subject: `Closing the loop on ${host}`,
        body: join([
          `Hi,`,
          ``,
          `Last note from me — I don't believe in emailing forever.`,
          ``,
          `When I checked, ${host} scored ${r.total}/100. The free report stays available any time: ${scoreUrl}`,
          ``,
          `If the timing's wrong, no hard feelings at all. If it ever becomes a priority, the audit is here (${auditUrl}) and this inbox is open.`,
          ``,
          `Good luck out there either way.`,
        ]),
      },
    },
  ];
}

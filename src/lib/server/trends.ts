/**
 * Trend Radar: a weekly Grok live-search scan of the creator's niche — what's
 * moving on X and the web right now — landing as scored ideas in their
 * backlog plus one notification. No repurposing competitor has live-trend
 * awareness; this is the xAI-specific edge.
 *
 * Honest-by-design: if live search is unavailable (no key, API rejects the
 * search parameters), we do NOTHING rather than deliver hallucinated
 * "trends".
 */

import { bestPlanFor, getBrandVoice, insertEvent, insertIdea, insertNotification } from "./db";
import { scoreHook } from "./generate";

interface Trend {
  topic: string;
  why: string;
  hook: string;
}

/** Pulls the assistant text out of a /v1/responses payload, tolerating both
 *  the convenience field and the structured output array. */
function extractResponsesText(d: unknown): string {
  const data = d as Record<string, unknown>;
  if (typeof data?.output_text === "string") return data.output_text;
  const out = Array.isArray(data?.output) ? (data.output as Record<string, unknown>[]) : [];
  const parts: string[] = [];
  for (const item of out) {
    const content = Array.isArray(item?.content)
      ? (item.content as Record<string, unknown>[])
      : [];
    for (const c of content) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

export async function runTrendRadar(email: string): Promise<boolean> {
  // Matches the pricing page: each scan is a live web_search spend, so the
  // radar runs for paid plans only.
  if (bestPlanFor(email) === "Free") return false;

  const { resolveField } = await import("./integrations");
  const key = resolveField("llm", "xaiApiKey");
  if (!key) return false;

  const voice = getBrandVoice(email);
  const niche = (voice.audience || "").trim();
  if (!niche) return false; // no niche context → nothing meaningful to scan

  try {
    // Agent Tools API: server-side web_search on /v1/responses (the old
    // chat-completions search_parameters returns 410 Gone).
    const resp = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.7",
        tools: [{ type: "web_search" }],
        input: [
          {
            role: "system",
            content:
              'You are a trend scout for content creators. Using CURRENT web and X search results only, find 3 topics or hook patterns trending THIS WEEK relevant to the creator\'s audience. For each: "topic" (what is trending), "why" (one sentence, cite what you saw), "hook" (a ready-to-use video title riding the trend, 6-14 words). Respond ONLY with a JSON object: {"trends":[{"topic","why","hook"}]}. If you cannot find genuinely current signals, return {"trends":[]}.',
          },
          {
            role: "user",
            content: `Creator's audience/niche: ${niche.slice(0, 300)}`,
          },
        ],
      }),
    });
    if (!resp.ok) {
      insertEvent("trend_radar_fail", email, String(resp.status));
      return false;
    }
    const data = await resp.json();
    const text = extractResponsesText(data);
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
      trends?: Trend[];
    };
    const trends = (parsed.trends ?? [])
      .filter((t) => t?.hook && t?.topic)
      .slice(0, 3);
    if (!trends.length) return false;

    for (const t of trends) {
      insertIdea(email, {
        id: `idea-${crypto.randomUUID()}`,
        title: String(t.hook).slice(0, 200),
        notes: `🔥 Trend Radar: ${String(t.topic).slice(0, 200)} — ${String(t.why).slice(0, 400)}`,
        script: "",
        score: Math.min(10, Math.max(1, scoreHook(String(t.hook)))),
        status: "idea",
      });
    }
    insertNotification(email, {
      id: `n-${crypto.randomUUID()}`,
      title: "Trend Radar",
      message: `${trends.length} trending angle${trends.length === 1 ? "" : "s"} in your niche this week — dropped into your Ideas backlog: ${trends
        .map((t) => `"${t.topic}"`)
        .join(", ")}.`,
      time: "Just now",
      read: false,
      type: "info",
    });
    insertEvent("trend_radar", email, String(trends.length));
    return true;
  } catch {
    return false;
  }
}

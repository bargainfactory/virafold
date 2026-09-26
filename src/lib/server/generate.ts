/**
 * Content repurposing engine — turns one long-form input (a transcript/script,
 * plus the title) into multiple real, ready-to-post assets whose text is derived
 * from the actual input (not mock data).
 *
 * Today this runs a deterministic, dependency-free generator. It is written so
 * an LLM (Claude/GPT) can be dropped in for higher-quality output: set an API
 * key and implement `generateWithLLM`, and `generateAssets` will prefer it and
 * fall back to the deterministic engine on any error.
 *
 * Both paths honor the user's BrandVoice profile: tone/audience steer the LLM
 * prompt, while CTA/hashtags/signature/banned-words/emoji policy are applied
 * mechanically so they hold even in deterministic mode.
 */

import { labelsFor } from "./generate-labels";
import type { BrandVoice } from "@/lib/data";

export interface GeneratedAsset {
  name: string;
  type: string; // e.g. "YouTube Short", "LinkedIn Carousel", "Newsletter", "X Thread"
  content: string; // human-readable, ready-to-post body
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function condense(s: string, max = 140): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

function shortTitle(t: string, n = 5): string {
  return t.trim().split(/\s+/).slice(0, n).join(" ") || "Your content";
}

function hashtag(t: string): string {
  return "#" + t.replace(/[^a-zA-Z0-9]/g, "").slice(0, 18);
}

/** Heuristic "virality" score used to pick hook-worthy sentences. Also
 *  exported to score backlog ideas in the Ideas tab. */
export function scoreHook(s: string): number {
  let score = 0;
  if (/\?/.test(s)) score += 2;
  if (/\d/.test(s)) score += 2;
  if (
    /\b(how|why|secret|mistake|never|always|stop|start|truth|biggest|proven|step|steps|way|ways|hack|avoid|nobody|everyone)\b/i.test(
      s
    )
  )
    score += 3;
  const w = wordCount(s);
  if (w >= 6 && w <= 26) score += 2;
  else if (w > 26) score -= 1;
  return score;
}

// --- Brand voice application (mechanical transforms, engine-agnostic) ---

function stripEmojis(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/ {2,}/g, " ")
    .replace(/^ +/gm, "");
}

function removeBanned(s: string, banned: string): string {
  const words = banned
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
  let out = s;
  for (const w of words) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), "").replace(/ {2,}/g, " ");
  }
  return out;
}

/**
 * Enforces the parts of the voice profile that can be applied to finished
 * text (banned words, emoji policy). Runs on LLM output too, as a backstop —
 * the model is instructed to comply, but this makes it a guarantee.
 */
export function applyVoice(
  assets: GeneratedAsset[],
  voice?: BrandVoice
): GeneratedAsset[] {
  if (!voice) return assets;
  return assets.map((a) => {
    let name = a.name;
    let content = a.content;
    if (voice.bannedWords.trim()) {
      name = removeBanned(name, voice.bannedWords);
      content = removeBanned(content, voice.bannedWords);
    }
    if (!voice.emojis) {
      name = stripEmojis(name);
      content = stripEmojis(content);
    }
    return { ...a, name: name.trim(), content: content.trim() };
  });
}

/** Renders the voice profile as prompt directives for the LLM path. */
function voiceBlock(voice?: BrandVoice): string {
  if (!voice) return "";
  const lines: string[] = [];
  if (voice.tone.trim()) lines.push(`Tone of voice: ${voice.tone.trim()}`);
  if (voice.audience.trim()) lines.push(`Target audience: ${voice.audience.trim()}`);
  if (voice.cta.trim()) lines.push(`Default call-to-action to use: ${voice.cta.trim()}`);
  if (voice.hashtags.trim()) lines.push(`Preferred hashtags: ${voice.hashtags.trim()}`);
  if (voice.bannedWords.trim())
    lines.push(`NEVER use these words/phrases: ${voice.bannedWords.trim()}`);
  if (voice.signature.trim())
    lines.push(`Sign-off / signature for newsletters and threads: ${voice.signature.trim()}`);
  if (!voice.emojis) lines.push("Do NOT use emojis anywhere.");
  return lines.length
    ? `\n\nBrand voice profile (follow strictly):\n- ${lines.join("\n- ")}`
    : "";
}

/**
 * Deterministic generator. Produces clips + a LinkedIn carousel, a newsletter,
 * and an X thread whose contents are extracted/condensed from the transcript.
 */
export function generateAssetsDeterministic(
  title: string,
  transcript: string,
  locale?: string,
  voice?: BrandVoice
): GeneratedAsset[] {
  const L = labelsFor(locale);
  const topic = shortTitle(title, 8);
  const sents = transcript ? splitSentences(transcript) : [];
  const source = sents.length ? sents : [`${topic}: ${L.fallback}`];
  const ranked = source
    .map((s, i) => ({ s, i, score: scoreHook(s) }))
    .sort((a, b) => b.score - a.score);

  const cta = voice?.cta.trim() || "";
  const tags = voice?.hashtags.trim() || "";
  const signature = voice?.signature.trim() || "";

  const assets: GeneratedAsset[] = [];

  // --- Short-form clips (3–6) ---
  const clipCount = Math.min(6, Math.max(3, Math.round(source.length / 4) || 3));
  const platforms = [L.typeYoutubeShort, L.typeTiktokClip, L.typeInstagramReel];
  ranked.slice(0, clipCount).forEach((h, idx) => {
    const hook = h.s;
    const name =
      hook.split(/\s+/).slice(0, 7).join(" ").replace(/[.,!?;:]+$/, "") + "…";
    const secs = 24 + ((idx * 7) % 36);
    const platform = platforms[idx % platforms.length];
    assets.push({
      name,
      type: platform,
      content: `🎬 ${platform} — ~0:${String(secs).padStart(2, "0")}

${L.hook}
"${hook}"

${L.body}
${source.slice(h.i, h.i + 2).join(" ")}

${L.caption} ${name}
${L.ctaWord}: ${cta || `${L.ctaFollow} ${topic}.`}
${tags || `${hashtag(topic)} ${L.hashtags}`}`,
    });
  });

  // --- LinkedIn carousel ---
  const slides = ranked
    .slice(0, 7)
    .map((h, i) => `${L.slide} ${i + 2}: ${condense(h.s, 110)}`);
  assets.push({
    name: `${shortTitle(topic)} — ${L.nameCarousel}`,
    type: L.typeCarousel,
    content: `📑 ${L.typeCarousel} (9 ${L.slidesWord})

${L.slide} 1 (${L.hookWord}): ${topic}
${slides.join("\n")}
${L.slide} 9 (${L.ctaWord}): ${cta || L.carouselCta}`,
  });

  // --- Newsletter ---
  assets.push({
    name: `${shortTitle(topic)} — ${L.nameNewsletter}`,
    type: L.typeNewsletter,
    content: `✉️ ${L.newsletterEdition}

${L.subject} ${topic}

${L.newsletterIntro}

${source.slice(0, 3).join(" ")}

${L.takeaways}
${ranked
  .slice(0, 3)
  .map((h, i) => `${i + 1}. ${condense(h.s, 120)}`)
  .join("\n")}

${L.newsletterOutro}${signature ? `\n\n${signature}` : ""}`,
  });

  // --- X / Twitter thread ---
  const tweets = ranked.slice(0, 8).map((h, i) => `${i + 2}/ ${condense(h.s, 240)}`);
  const close = [L.threadClose, cta, signature].filter(Boolean).join("\n");
  assets.push({
    name: `${shortTitle(topic)} — ${L.nameThread}`,
    type: L.typeThread,
    content: `🧵 ${L.threadHeader}

1/ ${topic} — ${L.threadOpen}
${tweets.join("\n")}
${tweets.length + 2}/ ${close}`,
  });

  return applyVoice(assets, voice);
}

// --- Model evals (the safe-downgrade gate for the tier router) ---

const GOLDEN_EVAL = {
  title: "Why most creators quit at 90 days",
  transcript:
    "Most creators quit around day ninety, and it is almost never about talent. The first month runs on excitement. The second month runs on discipline. By the third month the numbers are still small, the effort is still large, and the gap between them feels personal. Here is what the data actually shows: channels that survive the first hundred days usually change only one thing — they stop judging every post and start judging every batch of ten. One post is noise. Ten posts is a signal. The creators who make it treat publishing like reps in a gym, not like lottery tickets. They also cut production time in half by batching: one recording day, one editing day, and the rest of the week off the tools. If you are close to quitting, do not change your niche. Change your unit of measurement.",
};

export interface TierEvalResult {
  tier: LlmTier;
  engine: string | null;
  ok: boolean;
  assetCount: number;
  avgHookScore: number;
  ms: number;
}

/** Runs the golden generation through one tier and grades it with the same
 *  deterministic checks the product uses — the gate before any model swap. */
export async function evalTier(tier: LlmTier): Promise<TierEvalResult> {
  const started = Date.now();
  const res = await llmComplete(
    LLM_SYSTEM,
    `Title: ${GOLDEN_EVAL.title}`,
    LLM_SCHEMA,
    { tier, context: `Transcript / script:\n${GOLDEN_EVAL.transcript}` }
  );
  const ms = Date.now() - started;
  if (!res) return { tier, engine: null, ok: false, assetCount: 0, avgHookScore: 0, ms };
  const assets = parseAssets(res.text) ?? [];
  const avg = assets.length
    ? Math.round(assets.reduce((a, x) => a + scoreHook(x.name), 0) / assets.length)
    : 0;
  return {
    tier,
    engine: res.engine,
    ok: assets.length >= 5,
    assetCount: assets.length,
    avgHookScore: avg,
    ms,
  };
}

// --- Format-scoped creation (the /create/[format] tool pages) ---

export const CREATE_FORMATS = [
  "youtube-shorts",
  "tiktok",
  "linkedin",
  "newsletter",
  "thread",
  "carousel",
] as const;
export type CreateFormat = (typeof CREATE_FORMATS)[number];

/**
 * One vertical, focused output: scopes the deterministic engine to a single
 * format. Clip formats return every hook variant relabeled to the requested
 * platform (each is a different angle on the same idea); LinkedIn synthesizes
 * a text post from the top-scored hooks.
 */
export function generateForFormat(
  title: string,
  transcript: string,
  locale: string | undefined,
  format: CreateFormat
): GeneratedAsset[] {
  const all = generateAssetsDeterministic(title, transcript, locale);
  const L = labelsFor(locale);
  const clipTypes = [L.typeYoutubeShort, L.typeTiktokClip, L.typeInstagramReel];
  switch (format) {
    case "youtube-shorts":
      return all
        .filter((a) => clipTypes.includes(a.type))
        .map((a) => ({ ...a, type: L.typeYoutubeShort }));
    case "tiktok":
      return all
        .filter((a) => clipTypes.includes(a.type))
        .map((a) => ({ ...a, type: L.typeTiktokClip }));
    case "carousel":
      return all.filter((a) => a.type === L.typeCarousel);
    case "newsletter":
      return all.filter((a) => a.type === L.typeNewsletter);
    case "thread":
      return all.filter((a) => a.type === L.typeThread);
    case "linkedin": {
      const sents = transcript ? splitSentences(transcript) : [title];
      const ranked = sents
        .map((s) => ({ s, score: scoreHook(s) }))
        .sort((a, b) => b.score - a.score);
      const hook = ranked[0]?.s ?? title;
      const body = ranked
        .slice(1, 4)
        .map((h, i) => `${i + 1}. ${condense(h.s, 140)}`)
        .join("\n");
      return [
        {
          name: hook.split(/\s+/).slice(0, 7).join(" "),
          type: "LinkedIn Post",
          content: `${condense(hook, 180)}\n\n${L.takeaways}\n${body || condense(title, 140)}\n\n${L.carouselCta}`,
        },
      ];
    }
  }
}

const LLM_SYSTEM = `You are Virafold's content-repurposing engine. Given a title and a transcript/script of long-form content, produce a set of ready-to-post short-form assets derived from the ACTUAL content (never generic filler).
Produce 8-10 assets spanning: several short-form video clips (each with a hook line, body, on-screen caption idea, and 2-3 hashtags), one LinkedIn carousel (numbered slides), one email newsletter edition, and one X/Twitter thread. Use the "type" field to label each (e.g. "YouTube Short", "TikTok Clip", "Instagram Reel", "LinkedIn Carousel", "Newsletter", "X Thread"). "content" is the full ready-to-post text. "name" is a short human label.`;

const LLM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assets"],
  properties: {
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type", "content"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  },
} as const;

const REGEN_SYSTEM = `You are Virafold's content-repurposing engine. Regenerate ONE existing short-form asset from the source transcript/script. Keep the same asset type and general format, but produce a fresh, improved version derived from the ACTUAL source content (never generic filler). If revision feedback is provided, applying it takes priority. "content" is the full ready-to-post text. "name" is a short human label.`;

const REGEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "type", "content"],
  properties: {
    name: { type: "string" },
    type: { type: "string" },
    content: { type: "string" },
  },
} as const;

/**
 * Tier-routed LLM call — the token-efficiency core.
 *
 * Tasks declare a tier, never a model: flagship (full generation, scripts),
 * standard (coaching, highlight detection), fast (one-line rewrites). The
 * tier→model mapping is operator-editable ("routing" integration, values like
 * "anthropic:claude-opus-5" / "xai:grok-4" / "custom:llama-3.3-70b"), so
 * adopting a new frontier or open-source model is a config change, not a
 * deploy. "custom" hits any OpenAI-compatible endpoint (vLLM, Ollama, Groq,
 * Together…) configured in the "customllm" integration.
 *
 * Reusable context (transcripts) is passed separately: Anthropic gets it as a
 * cache_control block (repeat calls pay ~10% input cost), others get it
 * prepended. Every successful call logs tier/engine/token telemetry.
 * Any failure falls through the provider chain; null → deterministic engine.
 */
export type LlmTier = "flagship" | "standard" | "fast";

export interface LlmOpts {
  tier?: LlmTier;
  maxTokens?: number;
  /** Large reusable context (e.g. a transcript) — provider-cached where supported. */
  context?: string;
}

/**
 * Anthropic structured outputs require `additionalProperties: false` on every
 * object in the schema — without it the API 400s, which silently knocked the
 * whole flagship tier down to the next provider. Applied recursively so no
 * call site has to remember.
 */
function strictSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(strictSchema);
  if (s && typeof s === "object") {
    const o: Record<string, unknown> = { ...(s as Record<string, unknown>) };
    for (const k of Object.keys(o)) o[k] = strictSchema(o[k]);
    if (o.type === "object" && o.properties && o.additionalProperties === undefined) {
      o.additionalProperties = false;
    }
    return o;
  }
  return s;
}

const TIER_DEFAULTS: Record<LlmTier, { route: string; maxTokens: number }> = {
  flagship: { route: "anthropic:claude-opus-5", maxTokens: 32000 },
  standard: { route: "xai:grok-4.7", maxTokens: 8192 },
  fast: { route: "openai:gpt-4o-mini", maxTokens: 2048 },
};

function parseRoute(s: string): { provider: string; model: string } | null {
  const i = s.indexOf(":");
  if (i < 1) return null;
  return { provider: s.slice(0, i).trim().toLowerCase(), model: s.slice(i + 1).trim() };
}

export async function llmComplete(
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  opts: LlmOpts = {}
): Promise<{ text: string; engine: string } | null> {
  const tier: LlmTier = opts.tier ?? "flagship";
  // Resolve keys from env or the integrations store, without a static import
  // cycle at module load.
  const { resolveField } = await import("./integrations");
  const creds = {
    anthropic: resolveField("llm", "anthropicApiKey"),
    xai: resolveField("llm", "xaiApiKey"),
    openai: resolveField("llm", "openaiApiKey"),
    customUrl: resolveField("customllm", "baseUrl"),
    customModel: resolveField("customllm", "model"),
    customKey: resolveField("customllm", "apiKey"),
  };
  const maxTokens = opts.maxTokens ?? TIER_DEFAULTS[tier].maxTokens;

  // Routed model first, then the default chain (one attempt per provider).
  const routed = parseRoute(
    resolveField("routing", `${tier}Model`) || TIER_DEFAULTS[tier].route
  );
  const attempts: { provider: string; model: string }[] = [];
  const push = (a: { provider: string; model: string } | null) => {
    if (a && !attempts.some((x) => x.provider === a.provider)) attempts.push(a);
  };
  push(routed);
  push({ provider: "anthropic", model: "claude-opus-5" });
  push({ provider: "xai", model: "grok-4.7" });
  push({ provider: "openai", model: "gpt-4o" });
  if (creds.customUrl && creds.customModel) {
    push({ provider: "custom", model: creds.customModel });
  }

  const record = async (engine: string, inTok: number, outTok: number) => {
    try {
      const { insertEvent } = await import("./db");
      insertEvent(`llm_${tier}`, engine, JSON.stringify({ i: inTok, o: outTok }));
    } catch {
      /* telemetry is best-effort */
    }
  };

  for (const a of attempts) {
    try {
      if (a.provider === "anthropic") {
        if (!creds.anthropic) continue;
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: creds.anthropic });
        // Context block carries cache_control so repeated calls on the same
        // transcript hit the provider cache. Stream so adaptive thinking +
        // structured output share the budget without an HTTP timeout.
        const content = opts.context
          ? ([
              {
                type: "text",
                text: opts.context,
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: prompt },
            ] as never)
          : prompt;
        const stream = client.messages.stream({
          model: a.model,
          max_tokens: maxTokens,
          ...(tier === "flagship" ? { thinking: { type: "adaptive" } } : {}),
          system,
          output_config: { format: { type: "json_schema", schema: strictSchema(schema) } },
          messages: [{ role: "user", content }],
        } as never);
        const res = await stream.finalMessage();
        const text = res.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("");
        if (text) {
          const engine = `anthropic:${a.model}`;
          const u = res.usage as unknown as { input_tokens?: number; output_tokens?: number };
          await record(engine, u?.input_tokens ?? 0, u?.output_tokens ?? 0);
          return { text, engine };
        }
        continue;
      }

      // xAI / OpenAI / custom all speak the OpenAI chat-completions protocol.
      const base =
        a.provider === "xai"
          ? "https://api.x.ai/v1"
          : a.provider === "openai"
            ? "https://api.openai.com/v1"
            : (creds.customUrl ?? "").replace(/\/+$/, "");
      const key =
        a.provider === "xai"
          ? creds.xai
          : a.provider === "openai"
            ? creds.openai
            : creds.customKey || "none";
      if (!base || !key) continue;

      const user = opts.context ? `${opts.context}\n\n${prompt}` : prompt;
      const resp = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: a.model,
          response_format: { type: "json_object" },
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system + " Respond with a single JSON object." },
            { role: "user", content: user },
          ],
        }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) {
        const engine = `${a.provider}:${a.model}`;
        await record(
          engine,
          data?.usage?.prompt_tokens ?? 0,
          data?.usage?.completion_tokens ?? 0
        );
        return { text, engine };
      }
    } catch {
      /* fall through to the next provider */
    }
  }

  return null;
}

/**
 * Context diet: a transcript over the cap is reduced to its opening plus its
 * highest-hook-scoring sentences — what regeneration and coaching actually
 * use — instead of re-sending the whole thing.
 */
export function digestTranscript(transcript: string, cap = 4500): string {
  if (transcript.length <= cap) return transcript;
  const sents = splitSentences(transcript);
  let out = sents.slice(0, 3).join(" ");
  const ranked = sents
    .slice(3)
    .map((s) => ({ s, score: scoreHook(s) }))
    .sort((a, b) => b.score - a.score);
  for (const r of ranked) {
    if (out.length + r.s.length + 1 > cap) break;
    out += " " + r.s;
  }
  return out;
}

function langLine(locale?: string): string {
  return locale && locale !== "en"
    ? `\n\nWrite ALL asset names and content in this language (BCP-47 code): ${locale}.`
    : "";
}

/**
 * The performance flywheel's prompt side: hooks that measurably worked for
 * THIS creator become style exemplars for the next generation.
 */
function exemplarBlock(exemplars?: string[]): string {
  if (!exemplars || exemplars.length === 0) return "";
  return `\n\nThis creator's PROVEN top-performing hooks so far (study what makes them work — curiosity, specificity, numbers — and emulate the pattern; never copy them verbatim):\n- ${exemplars
    .slice(0, 5)
    .join("\n- ")}`;
}

export interface GenerationResult {
  assets: GeneratedAsset[];
  engine: string; // "deterministic" or the LLM identifier that produced them
}

function parseJsonLoose(text: string): unknown | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanAsset(a: unknown): GeneratedAsset | null {
  const r = a as Record<string, unknown> | null;
  if (!r || !r.name || !r.type || !r.content) return null;
  return { name: String(r.name), type: String(r.type), content: String(r.content) };
}

function parseAssets(text: string): GeneratedAsset[] | null {
  const parsed = parseJsonLoose(text);
  if (!parsed) return null;
  const assets = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>).assets;
  if (!Array.isArray(assets)) return null;
  const clean = assets.map(cleanAsset).filter((a): a is GeneratedAsset => a !== null);
  return clean.length ? clean : null;
}

export async function generateAssets(
  title: string,
  transcript: string,
  locale?: string,
  voice?: BrandVoice,
  exemplars?: string[]
): Promise<GenerationResult> {
  try {
    // The transcript rides as reusable context (provider-cached); the task
    // part stays small and cheap.
    const context = transcript ? `Transcript / script:\n${transcript}` : undefined;
    const userPrompt = `Title: ${title}${transcript ? "" : "\n\n(no transcript provided — infer from the title)"}${voiceBlock(voice)}${exemplarBlock(exemplars)}${langLine(locale)}`;
    const res = await llmComplete(LLM_SYSTEM, userPrompt, LLM_SCHEMA, {
      tier: "flagship",
      context,
    });
    if (res) {
      const parsed = parseAssets(res.text);
      if (parsed && parsed.length) {
        return { assets: applyVoice(parsed, voice), engine: res.engine };
      }
    }
  } catch {
    /* fall back to deterministic */
  }
  return {
    assets: generateAssetsDeterministic(title, transcript, locale, voice),
    engine: "deterministic",
  };
}

/**
 * Regenerates a single asset in place. The LLM path rewrites it from the
 * project's source transcript, honoring the optional user feedback and the
 * brand voice. Without a connected key, the deterministic engine re-runs and
 * the best same-type candidate is returned (feedback cannot be honored there —
 * the UI labels that mode accordingly).
 */
const SCRIPT_SYSTEM = `You are Virafold's long-form script writer. Given a content idea (title + optional notes), write a complete, ready-to-record long-form video/podcast script: a strong cold-open hook, a short intro, 4-6 clearly structured sections with concrete substance (specific examples, numbers, actionable steps — never generic filler), a recap, and a closing call to action. Write in a natural spoken voice, plain text with paragraph breaks, no markdown headers. Write for the ear: vary sentence length, and use em-dashes and ellipses to mark natural pauses and emphasis — the script may be narrated aloud by a human or by TTS. Respond as {"script": "..."}.`;

const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["script"],
  properties: { script: { type: "string" } },
} as const;

/**
 * Idea → long-form script (the reverse of repurposing). LLM when keyed; a
 * structured outline template otherwise, so the flow works in demo mode and
 * upgrades in place.
 */
export async function generateScript(
  title: string,
  notes: string,
  locale?: string,
  voice?: BrandVoice
): Promise<{ script: string; engine: string }> {
  try {
    const prompt = `Idea: ${title}${notes.trim() ? `\n\nNotes / angle:\n${notes.trim()}` : ""}${voiceBlock(voice)}${langLine(locale)}`;
    const res = await llmComplete(SCRIPT_SYSTEM, prompt, SCRIPT_SCHEMA, { tier: "flagship" });
    if (res) {
      const parsed = parseJsonLoose(res.text) as { script?: unknown } | null;
      const script = typeof parsed?.script === "string" ? parsed.script.trim() : "";
      if (script) {
        return {
          script: applyVoice([{ name: title, type: "Script", content: script }], voice)[0]
            .content,
          engine: res.engine,
        };
      }
    }
  } catch {
    /* fall back to the outline template */
  }

  const topic = shortTitle(title, 10);
  const cta = voice?.cta.trim() || `If this was useful, follow for more on ${topic}.`;
  const noteLines = notes
    .split(/\n+/)
    .map((n) => n.trim())
    .filter(Boolean);
  const sections =
    noteLines.length >= 3
      ? noteLines.slice(0, 6)
      : [
          `The biggest misconception about ${topic} — and what is actually true.`,
          `The mistake almost everyone makes first, and how to avoid it.`,
          `A step-by-step way to approach ${topic}, starting today.`,
          `A concrete example of this working in practice.`,
          `How to know it is working: the signals worth tracking.`,
        ];
  const script = [
    `Why does ${topic} matter more than people think? Stay with me — by the end of this you'll know exactly what to do about it.`,
    `Quick context before we get into it: most advice on ${topic} skips the part that actually moves the needle. That's what this is about.`,
    ...sections.map((s, i) => `Part ${i + 1}. ${s}\n\nLet's break that down with specifics you can act on.`),
    `Quick recap: ${sections
      .slice(0, 3)
      .map((s) => condense(s, 80))
      .join(" ")}`,
    `${cta}${voice?.signature.trim() ? `\n\n${voice.signature.trim()}` : ""}`,
  ].join("\n\n");
  return {
    script: applyVoice([{ name: title, type: "Script", content: script }], voice)[0].content,
    engine: "deterministic",
  };
}

export async function regenerateAsset(
  current: { name: string; type: string; content: string },
  ctx: {
    title: string;
    transcript: string;
    locale?: string;
    voice?: BrandVoice;
    feedback?: string;
    exemplars?: string[];
  }
): Promise<{ asset: GeneratedAsset; engine: string }> {
  try {
    // Context diet: a single-asset regen needs the transcript's best material,
    // not all 60k characters of it — and it runs on the standard tier.
    const digest = ctx.transcript ? digestTranscript(ctx.transcript) : "";
    const prompt = `Title: ${ctx.title}

Asset to regenerate:
Type: ${current.type}
Name: ${current.name}
Current content:
${current.content}${ctx.feedback?.trim() ? `\n\nRevision feedback (apply this): ${ctx.feedback.trim()}` : ""}${voiceBlock(ctx.voice)}${exemplarBlock(ctx.exemplars)}${langLine(ctx.locale)}`;
    const res = await llmComplete(REGEN_SYSTEM, prompt, REGEN_SCHEMA, {
      tier: "standard",
      context: digest ? `Source transcript / script (condensed):\n${digest}` : undefined,
    });
    if (res) {
      const parsed = cleanAsset(parseJsonLoose(res.text));
      // Keep the original type label so the asset stays grouped consistently.
      if (parsed) {
        return {
          asset: applyVoice([{ ...parsed, type: current.type }], ctx.voice)[0],
          engine: res.engine,
        };
      }
    }
  } catch {
    /* fall back to deterministic */
  }

  const det = generateAssetsDeterministic(
    ctx.title,
    ctx.transcript,
    ctx.locale,
    ctx.voice
  );
  const sameType = det.filter((a) => a.type === current.type);
  const pick =
    sameType.find((a) => a.content !== current.content) ??
    sameType[0] ??
    det.find((a) => a.content !== current.content) ??
    det[0];
  return {
    asset: pick ? { ...pick, type: current.type } : { ...current },
    engine: "deterministic",
  };
}

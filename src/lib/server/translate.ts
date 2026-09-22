/**
 * On-demand content translation with a permanent cache. Content stays
 * English and canonical (nothing translated is ever indexed); a reader who
 * asks gets an AI translation generated once per (content, language, version)
 * and cached forever — the total possible spend is bounded by
 * catalog size × languages, and edits invalidate via the content hash.
 */

import { createHash } from "node:crypto";
import { llmComplete } from "./generate";
import { getContentTranslation, setContentTranslation } from "./db";
import { locales, type Locale } from "@/lib/locales";

/** Collect every string leaf of a JSON value, depth-first. */
function flatten(x: unknown, out: string[]): void {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) for (const v of x) flatten(v, out);
  else if (x && typeof x === "object")
    for (const k of Object.keys(x as Record<string, unknown>)) flatten((x as Record<string, unknown>)[k], out);
}

/** Rebuild the same shape with translated leaves, consuming in order. */
function rebuild<T>(x: T, arr: string[], idx: { i: number }): T {
  if (typeof x === "string") return arr[idx.i++] as unknown as T;
  if (Array.isArray(x)) return x.map((v) => rebuild(v, arr, idx)) as unknown as T;
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x as Record<string, unknown>))
      o[k] = rebuild((x as Record<string, unknown>)[k], arr, idx);
    return o as unknown as T;
  }
  return x;
}

export function isTranslatableLocale(code: string): code is Locale {
  return code !== "en" && locales.some((l) => l.code === code);
}

const TRANSLATE_SCHEMA = {
  type: "object",
  properties: { strings: { type: "array", items: { type: "string" } } },
};

async function translateStrings(strings: string[], localeCode: Locale): Promise<string[] | null> {
  const lang = locales.find((l) => l.code === localeCode)?.name ?? localeCode;
  const system =
    `You are a professional translator. Translate each string in the "strings" array from English to ${lang}. ` +
    `Return ONLY JSON: {"strings": [...]} with EXACTLY the same number of strings, in the same order. Rules: ` +
    `1) A string starting with "## " keeps that exact prefix. ` +
    `2) Keep product/technical names untranslated: Virafold, YouTube, TikTok, LinkedIn, X, RSS, llms.txt, CSV, AI, virafold.ai and any URL. ` +
    `3) Preserve the tone: direct, concrete, zero hype. 4) No commentary — JSON only.`;
  const result = await llmComplete(system, JSON.stringify({ strings }), TRANSLATE_SCHEMA, {
    tier: "standard",
    maxTokens: 12000,
  });
  if (!result) return null;
  try {
    const raw = result.text;
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const out = parsed?.strings;
    if (!Array.isArray(out) || out.length !== strings.length) return null;
    if (!out.every((s: unknown) => typeof s === "string" && s.length > 0)) return null;
    return out as string[];
  } catch {
    return null;
  }
}

/**
 * Cached translate of any JSON-of-strings payload. `id` names the content
 * (e.g. "blog:my-slug", "audit:sa-..."); the hash of the English source
 * versions the cache, so edited content re-translates automatically.
 */
export async function getOrTranslate<T>(
  id: string,
  localeCode: Locale,
  source: T
): Promise<{ payload: T; cached: boolean } | null> {
  const json = JSON.stringify(source);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  const hit = getContentTranslation(id, localeCode, hash);
  if (hit) {
    try {
      return { payload: JSON.parse(hit) as T, cached: true };
    } catch {
      /* corrupt cache — regenerate */
    }
  }
  const strings: string[] = [];
  flatten(source, strings);
  if (!strings.length) return null;
  const translated = await translateStrings(strings, localeCode);
  if (!translated) return null;
  const payload = rebuild(source, translated, { i: 0 });
  setContentTranslation(id, localeCode, hash, JSON.stringify(payload));
  return { payload, cached: false };
}

/**
 * Honesty linter: mechanically flags numeric claims in generated content
 * that do NOT appear in the source material. The platform's no-invented-
 * numbers rule, turned from a prompt instruction into a verifiable check —
 * same philosophy as the scene planner's numbersAppearIn gate.
 *
 * v1 scope is digits only (word-numbers like "three hundred" pass); flags
 * are advisory — shown in review, never auto-removed, because the human
 * approval gate is where judgment lives.
 */

/** Digit tokens in a text, commas stripped ("1,200" → "1200"). */
function digitTokens(s: string): Set<string> {
  return new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")));
}

export function honestyFlags(content: string, source: string): string[] {
  const sourceNums = digitTokens(source);
  const flags: string[] = [];
  const seen = new Set<string>();

  // Capture with surrounding symbol context so the flag reads naturally
  // ("$4,000", "340%", "10x") rather than as a bare digit string.
  const re = /\$?\d[\d,]*(?:\.\d+)?(?:\s?%|x\b|[kKmM]\b)?/g;
  for (const m of content.match(re) ?? []) {
    const surface = m.trim();
    const bare = surface.replace(/[$,%xkKmM\s]/g, "");
    if (!bare) continue;
    // Skip the noise classes: single digits (list numbering, "3 tips"),
    // plausible years, and clock/aspect patterns are handled by bare-length
    // and the year window.
    if (bare.length === 1) continue;
    const asInt = Number(bare);
    if (Number.isInteger(asInt) && asInt >= 1900 && asInt <= 2099 && bare.length === 4) continue;
    if (sourceNums.has(bare)) continue;
    if (seen.has(bare)) continue;
    seen.add(bare);
    flags.push(surface);
    if (flags.length >= 6) break;
  }
  return flags;
}

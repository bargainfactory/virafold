/**
 * Multi-voice dialogue: screenplay-lite parsing and voice casting.
 *
 * A script becomes a screenplay when lines carry speaker tags:
 *   NARRATOR: A giant stood in the valley.
 *   ELI: Pip, look! He's not running away.
 *   PIP: He's so small...
 * Untagged lines continue the previous speaker. Fewer than two distinct
 * tagged speakers means "not a screenplay" and the single-narrator path runs
 * unchanged. Speakers are cast to voices by matching cast-prop names; props
 * without an assigned voice get distinct defaults so two characters never
 * share a voice by accident.
 */

export interface DialogueLine {
  speaker: string;
  text: string;
}

const TAG_RE = /^([A-Z][A-Z0-9 .'-]{0,24}):\s*(.+)$/;
const NARRATOR_RE = /^(NARRATOR|VOICEOVER|VO|NARRATION)$/i;

export function parseScreenplay(script: string): DialogueLine[] | null {
  const out: DialogueLine[] = [];
  let tagged = 0;
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = TAG_RE.exec(line);
    if (m) {
      tagged++;
      out.push({ speaker: m[1].trim().toUpperCase(), text: m[2].trim() });
    } else if (out.length) {
      out[out.length - 1].text += ` ${line}`;
    } else {
      out.push({ speaker: "NARRATOR", text: line });
    }
  }
  const speakers = new Set(out.map((l) => l.speaker));
  if (tagged < 2 || speakers.size < 2) return null;
  return out;
}

/** Distinct fallback voices for speakers nobody assigned one to. */
const VOICE_POOL = ["luna", "orion", "perseus", "helix"];

/**
 * speaker → voice name (null = the account's default narration chain).
 * Cast props win by name match; unmatched speakers draw distinct voices from
 * the pool in order of first appearance.
 */
export function castVoices(
  lines: DialogueLine[],
  cast: { name: string; voice: string | null }[]
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  let poolIdx = 0;
  for (const line of lines) {
    if (map.has(line.speaker)) continue;
    if (NARRATOR_RE.test(line.speaker)) {
      map.set(line.speaker, null);
      continue;
    }
    const sp = line.speaker.toLowerCase();
    const match = cast.find((p) => {
      const n = p.name.toLowerCase();
      return n.startsWith(sp) || sp.startsWith(n.split(" ")[0]);
    });
    map.set(line.speaker, match?.voice || VOICE_POOL[poolIdx++ % VOICE_POOL.length]);
  }
  return map;
}

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
  /** Explicit voice directive from the tag: SPEAKER(voicename): — wins over
   *  prop assignment, and needs no prop (so no face enters the scenes). */
  voice?: string;
  text: string;
}

const TAG_RE = /^([A-Z][A-Z0-9 .'-]{0,24})(?:\(([a-zA-Z]{2,16})\))?:\s*(.+)$/;
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
      out.push({
        speaker: m[1].trim().toUpperCase(),
        ...(m[2] ? { voice: m[2].toLowerCase() } : {}),
        text: m[3].trim(),
      });
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

/**
 * Frame vs story: a narrated tale with a recurring cast has two visual worlds —
 * the fireside FRAME (the storyteller and listeners) and the STORY being told.
 * Narrator lines and explicit-voice guests (SPEAKER(voicename):) belong to the
 * story; named speakers without a voice directive are the frame cast.
 */
export function isFrameLine(line: DialogueLine): boolean {
  return !line.voice && !NARRATOR_RE.test(line.speaker);
}

/** Distinct fallback voices for speakers nobody assigned one to. */
const VOICE_POOL = ["luna", "orion", "perseus", "helix"];

/**
 * speaker → voice name (null = the account's default narration chain).
 * Cast props win by script-name (charname) match first — the explicit speaker
 * tag a prop answers to — then by the prop-name heuristic (which only works
 * when a prop is literally named after its character); unmatched speakers draw
 * distinct voices from the pool in order of first appearance.
 */
export function castVoices(
  lines: DialogueLine[],
  cast: { name: string; voice: string | null; charname?: string | null }[]
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  let poolIdx = 0;
  for (const line of lines) {
    if (map.has(line.speaker)) continue;
    // Explicit in-script directive wins: SPEAKER(voicename):
    if (line.voice) {
      map.set(line.speaker, line.voice);
      continue;
    }
    if (NARRATOR_RE.test(line.speaker)) {
      map.set(line.speaker, null);
      continue;
    }
    const sp = line.speaker.toLowerCase();
    const match =
      cast.find((p) => p.charname && p.charname.trim().toLowerCase() === sp) ??
      cast.find((p) => {
        const n = p.name.toLowerCase();
        return n.startsWith(sp) || sp.startsWith(n.split(" ")[0]);
      });
    map.set(line.speaker, match?.voice || VOICE_POOL[poolIdx++ % VOICE_POOL.length]);
  }
  return map;
}

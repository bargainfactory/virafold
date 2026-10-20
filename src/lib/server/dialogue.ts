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

/**
 * The full xAI voice roster with genders, as returned by GET /v1/tts/voices
 * (fetched live 2026-10-19). Big casts draw distinct voices from here.
 */
export const XAI_VOICE_ROSTER: { id: string; g: "f" | "m" }[] = [
  { id: "eve", g: "f" }, { id: "luna", g: "f" }, { id: "aurora", g: "f" }, { id: "celeste", g: "f" },
  { id: "iris", g: "f" }, { id: "ara", g: "f" }, { id: "carina", g: "f" }, { id: "liora", g: "f" },
  { id: "ursa", g: "f" },
  { id: "orion", g: "m" }, { id: "perseus", g: "m" }, { id: "helix", g: "m" }, { id: "atlas", g: "m" },
  { id: "kepler", g: "m" }, { id: "leo", g: "m" }, { id: "castor", g: "m" }, { id: "altair", g: "m" },
  { id: "cosmo", g: "m" }, { id: "helios", g: "m" }, { id: "lumen", g: "m" }, { id: "lux", g: "m" },
  { id: "naksh", g: "m" }, { id: "rex", g: "m" }, { id: "rigel", g: "m" }, { id: "sal", g: "m" },
  { id: "sirius", g: "m" }, { id: "zagan", g: "m" }, { id: "zenith", g: "m" },
];

export function isXaiVoice(id: string): boolean {
  return XAI_VOICE_ROSTER.some((v) => v.id === id);
}

/** Distinct fallback voices for speakers nobody assigned one to. The first
 *  four stay in their historic order so old scripts re-render with the same
 *  voices; larger casts keep drawing fresh ones from the roster. */
const VOICE_POOL = ["luna", "orion", "perseus", "helix", "aurora", "atlas", "iris", "kepler"];
// Gendered pools so a grandmother never lands a baritone.
const POOL_F = XAI_VOICE_ROSTER.filter((v) => v.g === "f" && v.id !== "eve").map((v) => v.id).concat("eve");
const POOL_M = XAI_VOICE_ROSTER.filter((v) => v.g === "m").map((v) => v.id);

const FEMALE_HINT =
  /\b(woman|women|girl|grandmother|grandma|mother|mom|mama|lady|female|queen|princess|sister|aunt|wife|daughter|she|her|hers)\b/i;
const MALE_HINT =
  /\b(man|men|boy|grandfather|grandpa|father|dad|papa|male|king|prince|brother|uncle|husband|son|he|him|his)\b/i;

/** Best-effort gender read from a speaker tag + its prop's visual description. */
function genderOf(text: string): "f" | "m" | null {
  if (FEMALE_HINT.test(text)) return "f";
  if (MALE_HINT.test(text)) return "m";
  return null;
}

/**
 * speaker → voice name (null = the account's default narration chain).
 * Cast props win by script-name (charname) match first — the explicit speaker
 * tag a prop answers to — then by the prop-name heuristic (which only works
 * when a prop is literally named after its character); unmatched speakers draw
 * distinct voices from the pool in order of first appearance.
 */
export function castVoices(
  lines: DialogueLine[],
  cast: { name: string; voice: string | null; charname?: string | null; meta?: string | null }[]
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const used = new Set<string>();
  // First unused voice from a pool keeps speakers distinct; a full pool wraps.
  const take = (pool: string[]) => pool.find((v) => !used.has(v)) ?? pool[used.size % pool.length];
  for (const line of lines) {
    if (map.has(line.speaker)) continue;
    // Explicit in-script directive wins: SPEAKER(voicename):
    if (line.voice) {
      map.set(line.speaker, line.voice);
      used.add(line.voice);
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
    let v = match?.voice || null;
    if (!v) {
      // No assigned voice: draw from the pool matching the character's gender,
      // read from the speaker tag and the prop's visual description.
      const g = genderOf(`${line.speaker} ${match?.meta ?? match?.name ?? ""}`);
      v = take(g === "f" ? POOL_F : g === "m" ? POOL_M : VOICE_POOL);
    }
    map.set(line.speaker, v);
    used.add(v);
  }
  return map;
}

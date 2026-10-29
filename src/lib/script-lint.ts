/**
 * Script lint: the director's checklist, computable anywhere (client or
 * server) with zero cost. It mirrors the render engine's own trigger
 * vocabulary — camera moves, climax silences, quiz holds, song runs, foley —
 * so a writer can see what their words will DO before spending a cent on
 * generation. The regexes are duplicated from the engine on purpose: this
 * module must stay importable from client components, so it cannot pull in
 * server-only modules.
 */

const TAG_RE = /^([A-Z][A-Z0-9 _'-]{0,30})(?:\(([a-z0-9_-]+)\))?:\s*(.+)$/;
const NARRATOR_RE = /^narrator$/i;

const CUES: { id: string; label: string; re: RegExp }[] = [
  { id: "reaction", label: "push-in (reaction)", re: /\b(gasped|stared|amazed|astonish|realiz|eyes (went|grew|widened)|mouth(s)? (fell|dropped)|could not believe|froze|breath (caught|held)|held (his|her|their) breath|openmouthed|speechless)\b/i },
  { id: "reveal", label: "pull-back reveal", re: /\b(five thousand|ten thousand|whole (city|crowd|hillside|valley|army)|as far as (the eye|anyone)|stretched (from|across|out)|covered the (hill|earth|land)|from one (edge|horizon)|thousands upon thousands)\b/i },
  { id: "godSees", label: "overhead (God sees)", re: /\b(he saw (them|him|her)|god (saw|watched|remember(ed)?)|looked down (from|on|at)|heaven (saw|watched)|from (far )?above)\b/i },
  { id: "triumph", label: "low-angle triumph", re: /\b(stood up (straight|tall)|rose to his feet|stepped forward|came up out|lifted (his|her) head|standing his tallest|walked out (free|into the morning))\b/i },
  { id: "vulnerable", label: "high-angle vulnerability", re: /\b((all )?alone\b.*\b(pit|den|dark|thorn|road|sea|dust)|lay in the dust|small and (alone|shivering)|curled up|huddled|utterly alone)\b/i },
  { id: "creep", label: "creeping zoom", re: /\b(breathing in the dark|golden eyes|crept|creeping|silence|held its breath|watching|waited in the dark)\b/i },
  { id: "dolly", label: "dolly zoom", re: /\b(giant|towered|towering|loomed|enormous|vast|mighty|wall of)\b/i },
  { id: "bloom", label: "paint-into-being bloom", re: /\b(light (burst|broke|bloomed)|burst (from|out|across)|grass unrolling|land rose up|rolling the dark(ness)? back|bloom(ed|ing) into|sowing sparks|glowed to life|came alive|out of nothing)\b/i },
];

export const CLIMAX_LINT_RE =
  /\bpeace\.?,? be still\b|let there be light|your faith has made you|today,? salvation|and he answered me|it is very good|rise,? and go your way|the battle is the lord'?s/i;
const INTERACT_RE = /say it (out loud|with me)|i'?ll wait|we'?ll wait|shout it|got it\?|do you have (it|them) in your mind/i;
const SFX_RE = /\b(thunder|lightning|splash|into the waves|coins?|clink|knocked|pounded on|hammer-blow|rushed past|whirled|light broke|shone|glowed to life|healed|rainbow)\b/i;
const STORM_RE = /\b(storm|thunder|tempest|gale|howl(ing|ed)?|waves? (rose|broke|towered)|wall of (black )?water|sky collapsed)\b/i;

export interface LintLine {
  i: number;
  speaker: string;
  /** Explicit voice directive from SPEAKER(voice): — a story guest. */
  voice?: string;
  /** Fireside frame cast line (named speaker, no voice tag, not narrator). */
  frame: boolean;
  text: string;
  /** Camera / engine cues this line fires. */
  cues: string[];
  climax: boolean;
  hold: boolean;
  sfx: boolean;
}

export interface ChecklistItem {
  id: string;
  ok: boolean;
  note: string;
}

export interface ScriptLint {
  words: number;
  estMinutes: number;
  lines: LintLine[];
  speakers: string[];
  storySpeakers: string[];
  songRuns: { startLine: number; lines: number; firstAtSec: number }[];
  quizHolds: number;
  climaxCount: number;
  cueCounts: Record<string, number>;
  sfxCount: number;
  stormLines: number;
  checklist: ChecklistItem[];
}

const WPM = 178; // measured narration pace of the render engine

export function lintScript(script: string): ScriptLint {
  const rawLines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines: LintLine[] = [];
  const speakers = new Set<string>();
  const storySpeakers = new Set<string>();
  let t = 0; // running estimated seconds
  const songRuns: ScriptLint["songRuns"] = [];
  let run: { startLine: number; lines: number; firstAtSec: number } | null = null;
  let quizHolds = 0;
  let climaxCount = 0;
  let sfxCount = 0;
  let stormLines = 0;
  const cueCounts: Record<string, number> = {};

  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(TAG_RE);
    const speaker = m ? m[1].trim() : "NARRATOR";
    const voice = m?.[2];
    const text = m ? m[3] : rawLines[i];
    const frame = !voice && !NARRATOR_RE.test(speaker);
    speakers.add(speaker);
    if (voice || NARRATOR_RE.test(speaker)) {
      if (!NARRATOR_RE.test(speaker)) storySpeakers.add(speaker);
    }
    const cues = CUES.filter((c) => c.re.test(text)).map((c) => c.id);
    for (const c of cues) cueCounts[c] = (cueCounts[c] ?? 0) + 1;
    const climax = CLIMAX_LINT_RE.test(text);
    if (climax) climaxCount++;
    const hold = INTERACT_RE.test(text);
    if (hold) quizHolds++;
    const sfx = SFX_RE.test(text);
    if (sfx) sfxCount++;
    if (STORM_RE.test(text)) stormLines++;
    // Song-run heuristic, mirroring the engine: short frame-cast lines in a
    // run of three or more read as sung verses.
    const songish = frame && text.length < 100;
    if (songish) {
      if (!run) run = { startLine: i, lines: 0, firstAtSec: t };
      run.lines++;
    } else if (run) {
      if (run.lines >= 3) songRuns.push(run);
      run = null;
    }
    lines.push({ i, speaker, ...(voice ? { voice } : {}), frame, text, cues, climax, hold, sfx });
    t += (text.split(/\s+/).length / WPM) * 60 + 0.45;
  }
  if (run && run.lines >= 3) songRuns.push(run);

  const words = script.split(/\s+/).filter(Boolean).length;
  const estMinutes = t / 60;
  const checklist: ChecklistItem[] = [
    {
      id: "runtime",
      ok: estMinutes >= 1.2,
      note: `~${estMinutes.toFixed(1)} min from ${words} words`,
    },
    {
      id: "climax",
      ok: climaxCount >= 1,
      note: climaxCount ? `${climaxCount} climax line(s) earn carved silence + bloom` : "no climax line — no carved-silence moment",
    },
    {
      id: "firstSong",
      ok: songRuns.length > 0 && songRuns[0].firstAtSec < 120,
      note: songRuns.length ? `first song at ~${Math.round(songRuns[0].firstAtSec)}s (${songRuns.length} run(s))` : "no song run detected",
    },
    {
      id: "holds",
      ok: quizHolds >= 2,
      note: `${quizHolds} answer hold(s) ("Shout it out!" / "I'll wait")`,
    },
    {
      id: "reveal",
      ok: (cueCounts.reveal ?? 0) >= 1,
      note: cueCounts.reveal ? `${cueCounts.reveal} pull-back reveal(s)` : "no pull-back reveal — add a scale moment",
    },
    {
      id: "reaction",
      ok: (cueCounts.reaction ?? 0) >= 1,
      note: cueCounts.reaction ? `${cueCounts.reaction} reaction push-in(s)` : "no reaction cue — nobody gasps or freezes",
    },
    {
      id: "dolly",
      ok: (cueCounts.dolly ?? 0) >= 1,
      note: cueCounts.dolly ? "has a dolly-zoom moment" : "no towering/vast moment for the dolly zoom",
    },
    {
      id: "sfx",
      ok: sfxCount >= 3,
      note: `${sfxCount} foley trigger(s) (thunder/splash/coins/knock/whoosh/sparkle)`,
    },
  ];

  return {
    words,
    estMinutes,
    lines,
    speakers: [...speakers],
    storySpeakers: [...storySpeakers],
    songRuns,
    quizHolds,
    climaxCount,
    cueCounts,
    sfxCount,
    stormLines,
    checklist,
  };
}

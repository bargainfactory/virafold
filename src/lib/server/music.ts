import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Score engine: public-domain and original cues composed as MIDI (flute
 * melody, string pad, harp arpeggios), rendered once through FluidSynth into
 * a cue library, then assembled into a per-film score that follows the
 * narration's moods — tension under the storm, a lullaby under the lamp
 * moment. Everything here is best-effort: any missing tool or failure returns
 * null and the film renders exactly as before, without music.
 *
 * Licensing: melodies marked "after ..." are adaptations of public-domain
 * compositions (Brahms d. 1897, Grieg d. 1907, Crimond 1872, Simple Gifts
 * 1848, Pachelbel d. 1706); the rest are original. All recordings are
 * rendered in-house, so no third-party recording rights are involved.
 */

// --- Tiny MIDI writer (format 1) ---

type NoteEv = [start: number, dur: number, pitch: number, vel?: number];
interface CueTrack {
  prog: number; // GM program
  ch: number;
  notes: NoteEv[];
}
interface Cue {
  bpm: number;
  tracks: CueTrack[];
}

const TPB = 480; // ticks per beat

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

function midiBytes(cue: Cue): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(14);
  header.write("MThd");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(cue.tracks.length + 1, 10);
  header.writeUInt16BE(TPB, 12);
  chunks.push(header);

  const track = (events: number[][]) => {
    // events: [absTick, ...bytes] — sort, convert to deltas, wrap in MTrk.
    events.sort((a, b) => a[0] - b[0]);
    const body: number[] = [];
    let t = 0;
    for (const e of events) {
      body.push(...vlq(e[0] - t), ...e.slice(1));
      t = e[0];
    }
    body.push(0x00, 0xff, 0x2f, 0x00);
    const buf = Buffer.alloc(8 + body.length);
    buf.write("MTrk");
    buf.writeUInt32BE(body.length, 4);
    Buffer.from(body).copy(buf, 8);
    return buf;
  };

  // Tempo track.
  const uspq = Math.round(60_000_000 / cue.bpm);
  chunks.push(track([[0, 0xff, 0x51, 0x03, (uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff]]));

  for (const tr of cue.tracks) {
    const evs: number[][] = [[0, 0xc0 | tr.ch, tr.prog]];
    for (const [start, dur, pitch, vel = 70] of tr.notes) {
      evs.push([Math.round(start * TPB), 0x90 | tr.ch, pitch, vel]);
      evs.push([Math.round((start + dur) * TPB), 0x80 | tr.ch, pitch, 64]);
    }
    chunks.push(track(evs));
  }
  return Buffer.concat(chunks);
}

// --- Note helpers ---

const P: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C4" → 60; "Bb3" → 58; "F#4" → 66. */
function n(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + P[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

/** Sustained triad pad: one chord per entry [startBeat, durBeats, rootName, minor?]. */
function pad(chords: [number, number, string, boolean?][], vel = 46): NoteEv[] {
  const out: NoteEv[] = [];
  for (const [s, d, root, minor] of chords) {
    const r = n(root);
    out.push([s, d, r - 12, vel], [s, d, r, vel], [s, d, r + (minor ? 3 : 4), vel], [s, d, r + 7, vel]);
  }
  return out;
}

/** Harp arpeggio eighths over a chord window. */
function arp(chords: [number, number, string, boolean?][], vel = 52): NoteEv[] {
  const out: NoteEv[] = [];
  for (const [s, d, root, minor] of chords) {
    const r = n(root);
    const tones = [r, r + (minor ? 3 : 4), r + 7, r + 12];
    for (let b = 0; b + 0.5 <= d; b += 0.5) {
      out.push([s + b, 0.5, tones[Math.round(b * 2) % 4], vel]);
    }
  }
  return out;
}

function mel(seq: [number, number, string][], vel = 76): NoteEv[] {
  return seq.map(([s, d, name]) => [s, d, n(name), vel]);
}

// GM programs: 73 flute, 48 string ensemble, 46 harp, 42 cello.
const FLUTE = 73, STRINGS = 48, HARP = 46, CELLO = 42;

// --- The cue library ---

const CUES: Record<string, Cue> = {
  // Evening lamp — after Brahms' Lullaby (3/4). The series' goodnight.
  theme: {
    bpm: 76,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [0, 1, "E4"], [1, 1, "E4"], [2, 4, "G4"],
          [6, 1, "E4"], [7, 1, "E4"], [8, 4, "G4"],
          [12, 1, "E4"], [13, 1, "G4"], [14, 2, "C5"], [16, 2, "B4"], [18, 3, "A4"],
          [21, 1, "A4"], [22, 2, "G4"],
          [24, 1, "D4"], [25, 1, "E4"], [26, 2, "F4"], [28, 1, "D4"],
          [29, 1, "D4"], [30, 1, "E4"], [31, 3, "F4"],
          [34, 1, "F4"], [35, 1, "D4"], [36, 3, "G4"],
          [39, 1, "E4"], [40, 2, "D4"], [42, 6, "C4"],
        ]),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([
          [0, 6, "C3"], [6, 6, "C3"], [12, 3, "C3"], [15, 3, "G3"], [18, 3, "F3"], [21, 3, "G3"],
          [24, 6, "G3"], [30, 4, "F3"], [34, 2, "D3", true], [36, 3, "G3"], [39, 3, "G3"], [42, 6, "C3"],
        ]),
      },
      {
        prog: HARP, ch: 2,
        notes: arp([[0, 6, "C4"], [6, 6, "C4"], [24, 6, "G3"], [42, 6, "C4"]]),
      },
    ],
  },

  // Dawn — after Grieg's "Morning Mood" (6/8 feel).
  morning: {
    bpm: 72,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [0, 0.5, "G4"], [0.5, 0.5, "E4"], [1, 0.5, "D4"], [1.5, 0.5, "C4"], [2, 0.5, "D4"], [2.5, 0.5, "E4"],
          [3, 0.5, "G4"], [3.5, 0.5, "E4"], [4, 0.5, "D4"], [4.5, 0.5, "C4"], [5, 0.5, "D4"], [5.5, 0.5, "E4"],
          [6, 0.5, "G4"], [6.5, 0.5, "E4"], [7, 0.5, "G4"], [7.5, 0.5, "A4"], [8, 0.5, "E4"], [8.5, 0.5, "A4"],
          [9, 0.5, "G4"], [9.5, 0.5, "E4"], [10, 0.5, "D4"], [10.5, 0.5, "C4"], [11, 0.5, "D4"], [11.5, 0.5, "E4"],
          [12, 0.5, "G5"], [12.5, 0.5, "E5"], [13, 0.5, "D5"], [13.5, 0.5, "C5"], [14, 0.5, "D5"], [14.5, 0.5, "E5"],
          [15, 0.5, "G5"], [15.5, 0.5, "E5"], [16, 0.5, "G5"], [16.5, 0.5, "A5"], [17, 0.5, "E5"], [17.5, 0.5, "A5"],
          [18, 0.5, "G5"], [18.5, 0.5, "E5"], [19, 0.5, "D5"], [19.5, 0.5, "C5"], [20, 0.5, "D5"], [20.5, 0.5, "E5"],
          [21, 3, "C5"],
        ]),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([[0, 6, "C3"], [6, 3, "F3"], [9, 3, "C3"], [12, 6, "C3"], [18, 3, "F3"], [21, 3, "C3"]], 40),
      },
    ],
  },

  // Psalm — after the Crimond tune (Psalm 23), 3/4.
  shepherd: {
    bpm: 66,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [0, 1, "G4"], [1, 1, "C5"], [2, 1, "B4"], [3, 1, "C5"], [4, 1, "E5"], [5, 2, "D5"],
          [7, 1, "E5"], [8, 1, "D5"], [9, 1, "C5"], [10, 1, "A4"], [11, 2, "G4"],
          [13, 1, "G4"], [14, 1, "C5"], [15, 1, "D5"], [16, 1, "E5"], [17, 1, "G5"], [18, 2, "E5"],
          [20, 1, "D5"], [21, 1, "C5"], [22, 1, "D5"], [23, 1, "B4"], [24, 3, "C5"],
        ]),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([
          [0, 4, "C3"], [4, 3, "G3"], [7, 3, "A3", true], [10, 3, "F3"],
          [13, 4, "C3"], [17, 3, "C3"], [20, 2, "F3"], [22, 2, "G3"], [24, 3, "C3"],
        ]),
      },
      { prog: HARP, ch: 2, notes: arp([[0, 4, "C4"], [13, 4, "C4"], [24, 3, "C4"]]) },
    ],
  },

  // Celebration — after "Simple Gifts" (1848), 2/4.
  joy: {
    bpm: 104,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [0, 0.5, "G4"], [0.5, 0.5, "G4"], [1, 0.5, "C5"], [1.5, 0.5, "C5"], [2, 0.5, "D5"], [2.5, 0.5, "E5"],
          [3, 0.5, "C5"], [3.5, 0.5, "E5"], [4, 1, "D5"], [5, 0.5, "D5"], [5.5, 0.5, "E5"],
          [6, 0.5, "F5"], [6.5, 0.5, "E5"], [7, 0.5, "D5"], [7.5, 0.5, "C5"], [8, 1, "D5"],
          [9, 0.5, "C5"], [9.5, 0.5, "C5"], [10, 0.5, "G4"], [10.5, 0.5, "A4"], [11, 0.5, "C5"], [11.5, 0.5, "C5"],
          [12, 0.5, "B4"], [12.5, 0.5, "A4"], [13, 0.5, "G4"], [13.5, 0.5, "A4"], [14, 2, "C5"],
        ]),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([[0, 2, "C3"], [2, 2, "C3"], [4, 2, "G3"], [6, 2, "F3"], [8, 2, "G3"], [10, 2, "C3"], [12, 2, "G3"], [14, 2, "C3"]], 44),
      },
      { prog: HARP, ch: 2, notes: arp([[0, 2, "C4"], [4, 2, "G3"], [8, 2, "G3"], [12, 2, "G3"], [14, 2, "C4"]], 48) },
    ],
  },

  // Night watch — original, A minor, sparse.
  night: {
    bpm: 60,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [2, 3, "E5"], [6, 2, "C5"], [8, 2, "B4"], [10, 4, "A4"],
          [16, 3, "C5"], [20, 2, "B4"], [22, 2, "G4"], [24, 4, "A4"],
        ], 58),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([[0, 8, "A2", true], [8, 6, "F2"], [14, 8, "A2", true], [22, 6, "E3", true]], 36),
      },
      { prog: HARP, ch: 2, notes: arp([[0, 4, "A3", true], [14, 4, "A3", true]], 40) },
    ],
  },

  // Trouble — original, D minor ostinato, low strings only.
  tension: {
    bpm: 92,
    tracks: [
      {
        prog: CELLO, ch: 1,
        notes: ([] as NoteEv[]).concat(
          ...Array.from({ length: 8 }, (_, bar) => {
            const s = bar * 4;
            const step = bar % 2 === 0 ? "D3" : bar % 4 === 1 ? "Bb2" : "A2";
            return [
              [s, 1, n(step), 62], [s + 1, 1, n(step), 50], [s + 2, 1, n(step), 58], [s + 3, 1, n(step), 50],
            ] as NoteEv[];
          })
        ),
      },
      { prog: STRINGS, ch: 2, notes: pad([[0, 16, "D2", true], [16, 16, "D2", true]], 30) },
    ],
  },

  // Lament — original, D minor, a slow falling flute line over low strings.
  sorrow: {
    bpm: 54,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [2, 3, "D5"], [5, 2, "C5"], [7, 2, "A4"], [9, 4, "F4"],
          [14, 3, "G4"], [17, 2, "A4"], [19, 5, "D4"],
        ], 56),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([[0, 8, "D3", true], [8, 6, "Bb2"], [14, 6, "G2", true], [20, 6, "D3", true]], 34),
      },
      { prog: CELLO, ch: 2, notes: mel([[0, 8, "D2"], [8, 6, "Bb1"], [14, 6, "G1"], [20, 6, "D2"]], 30) },
    ],
  },

  // Majesty — original processional: stately block chords, a fanfare-like
  // flute on long tones, for glory, praise and decree moments.
  majesty: {
    bpm: 84,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [0, 2, "C5"], [2, 2, "G5"], [4, 3, "E5"], [7, 1, "F5"], [8, 4, "G5"],
          [12, 2, "A5"], [14, 2, "G5"], [16, 2, "E5"], [18, 2, "D5"], [20, 4, "C5"],
        ], 70),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([
          [0, 4, "C3"], [4, 4, "F3"], [8, 4, "C3"], [12, 4, "F3"], [16, 2, "G3"], [18, 2, "G3"], [20, 4, "C3"],
        ], 52),
      },
      { prog: CELLO, ch: 2, notes: mel([[0, 4, "C2"], [4, 4, "F2"], [8, 4, "C2"], [12, 4, "F2"], [16, 4, "G2"], [20, 4, "C2"]], 46) },
    ],
  },

  // On the road — original walking figure: light harp pulse and a simple
  // stepping flute motif for journeys and crossings.
  travel: {
    bpm: 100,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [0, 1, "G4"], [1, 1, "A4"], [2, 1, "B4"], [3, 1, "G4"],
          [4, 1, "C5"], [5, 1, "B4"], [6, 2, "A4"],
          [8, 1, "G4"], [9, 1, "A4"], [10, 1, "B4"], [11, 1, "D5"], [12, 2, "C5"], [14, 2, "G4"],
        ], 62),
      },
      { prog: HARP, ch: 2, notes: arp([[0, 4, "C4"], [4, 4, "G3"], [8, 4, "A3", true], [12, 4, "C4"]], 54) },
      { prog: STRINGS, ch: 1, notes: pad([[0, 8, "C3"], [8, 4, "A2", true], [12, 4, "C3"]], 32) },
    ],
  },

  // Wonder — strings and harp over the Pachelbel progression.
  wonder: {
    bpm: 68,
    tracks: [
      {
        prog: FLUTE, ch: 0,
        notes: mel([
          [0, 2, "E5"], [2, 2, "D5"], [4, 2, "C5"], [6, 2, "B4"],
          [8, 2, "A4"], [10, 2, "G4"], [12, 2, "A4"], [14, 2, "B4"],
          [16, 2, "C5"], [18, 2, "G4"], [20, 2, "A4"], [22, 2, "E4"],
          [24, 2, "F4"], [26, 2, "E4"], [28, 2, "F4"], [30, 2, "G4"],
        ], 68),
      },
      {
        prog: STRINGS, ch: 1,
        notes: pad([
          [0, 2, "C3"], [2, 2, "G3"], [4, 2, "A3", true], [6, 2, "E3", true],
          [8, 2, "F3"], [10, 2, "C3"], [12, 2, "F3"], [14, 2, "G3"],
          [16, 2, "C3"], [18, 2, "G3"], [20, 2, "A3", true], [22, 2, "E3", true],
          [24, 2, "F3"], [26, 2, "C3"], [28, 2, "F3"], [30, 2, "G3"],
        ], 42),
      },
      {
        prog: HARP, ch: 2,
        notes: arp([
          [0, 2, "C4"], [2, 2, "G3"], [4, 2, "A3", true], [6, 2, "E3", true],
          [8, 2, "F3"], [10, 2, "C4"], [12, 2, "F3"], [14, 2, "G3"],
        ], 50),
      },
    ],
  },
};

// --- Rendering & assembly ---

const MUSIC_DIR = path.join(process.cwd(), "data", "music");
const SOUNDFONTS = [
  "/usr/share/sounds/sf2/FluidR3_GM.sf2",
  "/usr/share/sounds/sf2/default-GM.sf2",
  "/usr/share/soundfonts/default.sf2",
];

function sh(cmd: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: "ignore" });
    p.on("error", () => resolve(-1));
    p.on("close", (code) => resolve(code ?? -1));
  });
}

/** Render (and cache) one cue to a wav; null when FluidSynth is unavailable. */
async function ensureCue(name: string): Promise<string | null> {
  const cue = CUES[name];
  if (!cue) return null;
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const wav = path.join(MUSIC_DIR, `${name}.wav`);
  if (fs.existsSync(wav) && fs.statSync(wav).size > 100_000) return wav;
  const sf = SOUNDFONTS.find((f) => fs.existsSync(f));
  if (!sf) return null;
  const mid = path.join(MUSIC_DIR, `${name}.mid`);
  fs.writeFileSync(mid, midiBytes(cue));
  const code = await sh("fluidsynth", ["-ni", "-g", "0.6", sf, mid, "-F", wav, "-r", "44100"]);
  if (code !== 0 || !fs.existsSync(wav) || fs.statSync(wav).size < 100_000) return null;
  return wav;
}

type Mood =
  | "theme" | "morning" | "shepherd" | "joy" | "night" | "tension" | "wonder"
  | "sorrow" | "majesty" | "travel";

const TENSION_RE =
  /\b(storm|wind|waves?|thunder|afraid|fear|lions?|giant|robbers?|danger|pit|prison|flood|trouble|enem|sink|dark)\b/i;
const SORROW_RE =
  /\b(wept|weeping|cried|tears|sad(ness)?|sorrow|alone|lonely|missed|mourn|grie(f|ved)|heart (sank|broke)|half alive)\b/i;
const JOY_RE =
  /\b(rejoice|celebrat|party|laugh|found|healed|home|rainbow|feast|joy|glad|danced|sang|sing|thank|hooray|welcome)\b/i;
const MAJESTY_RE =
  /\b(glory|praise|holy|worship|altar|decree|throne|king of|heavens? declare|salvation belongs)\b/i;
const WONDER_RE =
  /\b(let there be|creat|heavens?|miracle|spoke|light broke|amazed|wonder|obey|stars? (came|declare)|very good)\b/i;
const NIGHT_RE = /\b(night|sleep|asleep|lamp down|bed(time)?|quiet|still|hush|moonlit|evening)\b/i;
const TRAVEL_RE =
  /\b(road|journey|set out|sailed|traveled|walked (all|for|down)|miles|path wound|caravan|marched)\b/i;

/** Shared scene-mood read — the score and the camera breathe together. */
export function sceneMood(text: string): Mood {
  return moodFor(text);
}

function moodFor(text: string): Mood {
  if (TENSION_RE.test(text)) return "tension";
  if (SORROW_RE.test(text)) return "sorrow";
  if (JOY_RE.test(text)) return "joy";
  if (MAJESTY_RE.test(text)) return "majesty";
  if (WONDER_RE.test(text)) return "wonder";
  if (NIGHT_RE.test(text)) return "night";
  if (TRAVEL_RE.test(text)) return "travel";
  return "shepherd";
}

/**
 * Build the film's score: mood windows from the beats (in film time, i.e.
 * including the title-card lead), theme over the open and close, cues looped,
 * faded and concatenated into score.wav inside the plan dir.
 */
export async function buildScore(
  planDir: string,
  beats: { text: string; start: number; dur: number }[],
  duration: number,
  lead: number,
  tail: number
): Promise<string | null> {
  try {
    const total = lead + duration + tail;
    // Mood windows from beats, merged; short blips join their neighbor.
    const raw: { mood: Mood; start: number; end: number }[] = [];
    for (const b of beats) {
      const mood = moodFor(b.text);
      const start = lead + b.start;
      const end = start + b.dur;
      const prev = raw[raw.length - 1];
      if (prev && (prev.mood === mood || end - start < 6)) prev.end = end;
      else raw.push({ mood, start, end });
    }
    const windows: { mood: Mood; start: number; end: number }[] = [];
    for (const w of raw) {
      const prev = windows[windows.length - 1];
      if (prev && w.end - w.start < 12) prev.end = w.end;
      else windows.push({ ...w });
    }
    // Theme bookends.
    const openEnd = Math.min(lead + 35, total);
    const closeStart = Math.max(openEnd, total - 30);
    const mids = windows
      .map((w) => ({ ...w, start: Math.max(w.start, openEnd), end: Math.min(w.end, closeStart) }))
      .filter((w) => w.end - w.start >= 8);
    const final: { mood: Mood; start: number; end: number }[] = [
      { mood: "theme", start: 0, end: openEnd },
      ...mids,
      { mood: "theme", start: closeStart, end: total },
    ];
    // Close gaps so parts concat into a continuous track.
    for (let i = 1; i < final.length; i++) final[i].start = final[i - 1].end;
    final[final.length - 1].end = total;

    const parts: string[] = [];
    for (let i = 0; i < final.length; i++) {
      const w = final[i];
      const len = w.end - w.start;
      if (len <= 0.5) continue;
      const cueWav = (await ensureCue(w.mood)) ?? (await ensureCue("shepherd"));
      if (!cueWav) return null;
      const part = `score_part${i}.wav`;
      const fadeOut = Math.max(0.1, len - 1.5);
      const code = await sh(
        "ffmpeg",
        ["-y", "-stream_loop", "-1", "-i", cueWav, "-t", len.toFixed(3),
         "-af", `afade=t=in:d=1.0,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5,aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo`,
         part],
        planDir
      );
      if (code !== 0) return null;
      parts.push(part);
    }
    if (!parts.length) return null;
    fs.writeFileSync(path.join(planDir, "score_list.txt"), parts.map((p) => `file '${p}'`).join("\n"), "utf8");
    const code = await sh(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", "score_list.txt", "-c", "copy", "score.wav"],
      planDir
    );
    for (const p of parts) fs.rmSync(path.join(planDir, p), { force: true });
    fs.rmSync(path.join(planDir, "score_list.txt"), { force: true });
    if (code !== 0 || !fs.existsSync(path.join(planDir, "score.wav"))) return null;
    return "score.wav";
  } catch {
    return null;
  }
}

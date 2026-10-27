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

// GM programs: 73 flute, 48 string ensemble, 46 harp, 42 cello,
// 47 timpani, 115 woodblock.
const FLUTE = 73, STRINGS = 48, HARP = 46, CELLO = 42, TIMPANI = 47, WOODBLOCK = 115;

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
  // Storm — timpani heartbeat under trembling low strings; swells with the
  // thunder one-shots instead of borrowing the generic tension cue.
  storm: {
    bpm: 92,
    tracks: [
      {
        prog: TIMPANI, ch: 0,
        notes: Array.from({ length: 16 }, (_, b) => [b, 0.6, n("D2"), b % 4 === 0 ? 92 : 68] as NoteEv),
      },
      {
        prog: CELLO, ch: 1,
        notes: Array.from({ length: 64 }, (_, i) => [i * 0.25, 0.25, n(i % 8 < 4 ? "D3" : "C3"), 52] as NoteEv),
      },
      {
        prog: STRINGS, ch: 2,
        notes: pad([[0, 4, "D3", true], [4, 4, "Bb2"], [8, 4, "G2", true], [12, 4, "A2"]], 56),
      },
    ],
  },
  // Sing-along pulse — a clap-friendly woodblock tick with a light harp vamp;
  // the orchestra steps back so the chant leads and kids have a beat to clap.
  song: {
    bpm: 104,
    tracks: [
      {
        prog: WOODBLOCK, ch: 0,
        notes: ([0, 4, 8, 12] as number[]).flatMap((bar) => [
          [bar, 0.3, n("C5"), 88], [bar + 1, 0.3, n("C5"), 58], [bar + 1.75, 0.2, n("G4"), 48],
          [bar + 2, 0.3, n("C5"), 82], [bar + 3, 0.3, n("C5"), 58],
        ] as NoteEv[]),
      },
      {
        prog: HARP, ch: 1,
        notes: arp([[0, 4, "F3"], [4, 4, "C3"], [8, 4, "Bb3"], [12, 4, "C3"]], 48),
      },
    ],
  },
  // Miracle stinger (one-shot ~3.5s): harp rush up into a string-and-flute
  // bloom — overlaid exactly where light breaks and wonders happen.
  stinger: {
    bpm: 100,
    tracks: [
      {
        prog: HARP, ch: 0,
        notes: ["C4", "E4", "G4", "C5", "E5", "G5", "C6", "E6"].map(
          (p, i) => [i * 0.25, 0.3, n(p), 72] as NoteEv
        ),
      },
      { prog: STRINGS, ch: 1, notes: pad([[1, 4.5, "C4"]], 58) },
      { prog: FLUTE, ch: 2, notes: mel([[2, 1, "G5"], [3, 2.5, "C6"]], 66) },
    ],
  },
  // Character entrance motifs (one-shots): Pip's two-note flute hop, Eli's
  // gentle string dyad, Naomi's harp strum — played at each one's first line.
  motif_pip: {
    bpm: 120,
    tracks: [{ prog: FLUTE, ch: 0, notes: mel([[0, 0.4, "G5"], [0.5, 1.2, "C6"]], 84) }],
  },
  motif_eli: {
    bpm: 100,
    tracks: [{ prog: STRINGS, ch: 0, notes: [[0, 2, n("E4"), 54], [0, 2, n("G4"), 54]] as NoteEv[] }],
  },
  motif_naomi: {
    bpm: 110,
    tracks: [
      {
        prog: HARP, ch: 0,
        notes: [[0, 0.2, n("C4"), 70], [0.2, 0.2, n("E4"), 70], [0.4, 0.2, n("G4"), 70], [0.6, 1.4, n("C5"), 74]] as NoteEv[],
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
  | "sorrow" | "majesty" | "travel" | "storm";

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

const STORM_MOOD_RE = /\b(storm|thunder|tempest|gale|howl(ing|ed)?|waves? (rose|broke|towered)|wall of (black )?water|sky collapsed)\b/i;

function moodFor(text: string): Mood {
  if (STORM_MOOD_RE.test(text)) return "storm";
  if (TENSION_RE.test(text)) return "tension";
  if (SORROW_RE.test(text)) return "sorrow";
  if (JOY_RE.test(text)) return "joy";
  if (MAJESTY_RE.test(text)) return "majesty";
  if (WONDER_RE.test(text)) return "wonder";
  if (NIGHT_RE.test(text)) return "night";
  if (TRAVEL_RE.test(text)) return "travel";
  return "shepherd";
}

// --- Ambience / foley layer ---
//
// Synthesized soundscapes (fully owned, no asset licensing): fireside crackle
// with night crickets under the storytelling frame, wind and low thunder under
// storms, waves for the sea, light wind for journeys. Rendered once to cached
// 30s loops, then windowed over the film exactly like the score.

type Amb = "fireside" | "storm" | "waves" | "wind" | "crickets" | "rain";

// Noise-colour beds read as HISS under close dialogue (heard as "white noise
// when Naomi talks"), so the fireside and crickets beds are built from sparse
// velvet-noise pops and tonal chirps instead — crackle and crickets, not static.
const AMB_GRAPHS: Record<Amb, { inputs: string[]; fc: string }> = {
  fireside: {
    inputs: ["anoisesrc=colour=brown:r=44100:d=30", "anoisesrc=colour=velvet:r=44100:seed=7:density=0.0005:d=30"],
    fc: "[0:a]lowpass=f=380,tremolo=f=0.4:d=0.5,volume=0.45[f];[1:a]bandpass=f=1700:width_type=q:w=4,aecho=0.6:0.4:35|90:0.35|0.18,volume=7[p];[f][p]amix=inputs=2:normalize=0[a]",
  },
  storm: {
    inputs: ["anoisesrc=colour=brown:r=44100:d=30", "anoisesrc=colour=pink:r=44100:d=30"],
    fc: "[0:a]lowpass=f=150,tremolo=f=0.13:d=0.95,volume=0.9[r];[1:a]lowpass=f=1000,tremolo=f=0.3:d=0.7,volume=0.7[w];[r][w]amix=inputs=2:normalize=0[a]",
  },
  waves: {
    inputs: ["anoisesrc=colour=pink:r=44100:d=30"],
    fc: "[0:a]lowpass=f=500,tremolo=f=0.12:d=0.85,volume=0.8[a]",
  },
  wind: {
    inputs: ["anoisesrc=colour=pink:r=44100:d=30"],
    fc: "[0:a]lowpass=f=800,tremolo=f=0.22:d=0.6,volume=0.55[a]",
  },
  crickets: {
    inputs: ["sine=frequency=4150:r=44100:d=30", "sine=frequency=3650:r=44100:d=30"],
    fc: "[0:a]tremolo=f=27:d=0.97,tremolo=f=1.3:d=0.94,volume=0.14[c0];[1:a]tremolo=f=22:d=0.97,tremolo=f=0.8:d=0.94,adelay=400:all=1,volume=0.1[c1];[c0][c1]amix=inputs=2:normalize=0[a]",
  },
  // Gentle rain (vs. the storm bed's heavy rumble). v2: crisp, realistic —
  // a quiet wash under tick-sharp high droplets (barely filtered, so the
  // transients stay crisp) and sparse lower "plips" with one short bounce.
  rain: {
    inputs: [
      "anoisesrc=colour=pink:r=44100:d=30",
      "anoisesrc=colour=velvet:r=44100:seed=23:density=0.0007:d=30",
      "anoisesrc=colour=velvet:r=44100:seed=47:density=0.00016:d=30",
    ],
    fc: "[0:a]highpass=f=400,lowpass=f=5500,volume=0.13[w];[1:a]highpass=f=2800,lowpass=f=9500,volume=4.2[t];[2:a]bandpass=f=1300:width_type=q:w=2.2,aecho=0.5:0.25:22:0.22,volume=5.5[p];[w][t][p]amix=inputs=3:normalize=0[a]",
  },
};

async function ensureAmb(kind: Amb): Promise<string | null> {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  // Recorded-quality override: a generated/curated loop dropped into the
  // music cache (e.g. ElevenLabs SFX) beats the synthesized bed.
  const override = path.join(MUSIC_DIR, `el_${kind}.wav`);
  if (fs.existsSync(override) && fs.statSync(override).size > 100_000) return override;
  // amb2_: the v1 noise-bed cache must not serve the reworked graphs.
  const wav = path.join(MUSIC_DIR, `amb2_${kind}.wav`);
  if (fs.existsSync(wav) && fs.statSync(wav).size > 100_000) return wav;
  const g = AMB_GRAPHS[kind];
  const args = ["-y", ...g.inputs.flatMap((i) => ["-f", "lavfi", "-i", i]), "-filter_complex",
    `${g.fc.slice(0, -3)},aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo[a]`,
    "-map", "[a]", wav];
  const code = await sh("ffmpeg", args);
  return code === 0 && fs.existsSync(wav) ? wav : null;
}

// --- One-shot foley ---
//
// Discrete, slightly exaggerated cartoon SFX fired by story keywords at the
// beat where they happen — the clink when the Samaritan pays, the crack of
// thunder, the splash when Jonah goes in. Synthesized (no licensing), cached
// like the beds, overlaid onto the ambience track so one mix carries both.

type Sfx = "thunder" | "splash" | "coins" | "knock" | "whoosh" | "sparkle";

const SFX_GRAPHS: Record<Sfx, { inputs: string[]; fc: string }> = {
  thunder: {
    inputs: ["anoisesrc=colour=brown:r=44100:d=2.6"],
    fc: "[0:a]lowpass=f=220,volume='2.6*exp(-2.0*t)':eval=frame,afade=t=in:d=0.04[a]",
  },
  splash: {
    inputs: ["anoisesrc=colour=white:r=44100:d=1.1"],
    fc: "[0:a]highpass=f=400,lowpass=f=3200,volume='2.0*exp(-3.5*t)':eval=frame,afade=t=in:d=0.02[a]",
  },
  coins: {
    inputs: ["sine=frequency=2473:r=44100:d=0.6", "sine=frequency=3089:r=44100:d=0.5"],
    fc: "[0:a]volume='0.8*exp(-9*t)':eval=frame[c0];[1:a]volume='0.7*exp(-9*t)':eval=frame,adelay=140:all=1[c1];[c0][c1]amix=inputs=2:normalize=0[a]",
  },
  knock: {
    inputs: ["sine=frequency=85:r=44100:d=0.45", "sine=frequency=82:r=44100:d=0.45"],
    fc: "[0:a]volume='1.7*exp(-16*t)':eval=frame[k0];[1:a]volume='1.5*exp(-16*t)':eval=frame,adelay=230:all=1[k1];[k0][k1]amix=inputs=2:normalize=0[a]",
  },
  whoosh: {
    inputs: ["anoisesrc=colour=pink:r=44100:d=0.9"],
    fc: "[0:a]bandpass=f=900:width_type=q:w=1.2,afade=t=in:d=0.25,afade=t=out:st=0.45:d=0.45,volume=1.7[a]",
  },
  sparkle: {
    inputs: ["sine=frequency=1568:r=44100:d=0.8", "sine=frequency=1976:r=44100:d=0.7", "sine=frequency=2637:r=44100:d=0.9"],
    fc: "[0:a]volume='0.55*exp(-5*t)':eval=frame[s0];[1:a]volume='0.55*exp(-5*t)':eval=frame,adelay=130:all=1[s1];[2:a]volume='0.6*exp(-4*t)':eval=frame,adelay=260:all=1[s2];[s0][s1][s2]amix=inputs=3:normalize=0[a]",
  },
};

async function ensureSfx(kind: Sfx): Promise<string | null> {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const override = path.join(MUSIC_DIR, `el_sfx_${kind}.wav`);
  if (fs.existsSync(override) && fs.statSync(override).size > 10_000) return override;
  const wav = path.join(MUSIC_DIR, `sfx_${kind}.wav`);
  if (fs.existsSync(wav) && fs.statSync(wav).size > 10_000) return wav;
  const g = SFX_GRAPHS[kind];
  const args = ["-y", ...g.inputs.flatMap((i) => ["-f", "lavfi", "-i", i]), "-filter_complex",
    `${g.fc.slice(0, -3)},aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo[a]`,
    "-map", "[a]", wav];
  const code = await sh("ffmpeg", args);
  return code === 0 && fs.existsSync(wav) ? wav : null;
}

// Keyword → foley. Scripts direct their own sound by using these words at the
// moment the thing happens (the kit documents the palette).
const SFX_TRIGGERS: { kind: Sfx; re: RegExp }[] = [
  { kind: "thunder", re: /\b(thunder|lightning|crack(ed)? across the sky)\b/i },
  { kind: "splash", re: /\b(splash(ed)?|overboard|into the (sea|waves|water)|plunged)\b/i },
  { kind: "coins", re: /\b(coins?|denari(us|i)|silver pieces|pieces of silver|gold pieces|clink(ed)?)\b/i },
  { kind: "knock", re: /\b(knock(ed)?|pounded on|hammer-blow|hammered|thudded)\b/i },
  { kind: "whoosh", re: /\b(sling (sang|whirled)|whirled|whoosh(ed)?|swooped|rushed past)\b/i },
  { kind: "sparkle", re: /\b(let there be light|light broke|shone|glowed to life|healed|rainbow|miracle)\b/i },
];

const SEA_RE = /\b(sea|waves?|boat|shore|harbor|sail|deep dark sea|fish)\b/i;
const STORMY_RE = /\b(storm|thunder|tempest|howl|gale)\b/i;
const RAIN_RE = /\b(rain(ed|ing|drops)?|drizzle|downpour|drummed on the (great )?roof)\b/i;

function ambFor(text: string, frame: boolean | undefined): Amb | null {
  if (frame) return "fireside";
  if (STORMY_RE.test(text)) return "storm";
  if (RAIN_RE.test(text)) return "rain";
  if (SEA_RE.test(text)) return "waves";
  const m = moodFor(text);
  if (m === "night") return "crickets";
  if (m === "travel" || m === "tension") return "wind";
  return null;
}

/**
 * Build the film's ambience track: windowed soundscapes under the scenes
 * (silence where none applies), concatenated to ambience.wav in the plan dir.
 */
export async function buildAmbience(
  planDir: string,
  beats: { text: string; start: number; dur: number; frame?: boolean; song?: boolean }[],
  duration: number,
  lead: number,
  tail: number
): Promise<string | null> {
  try {
    const total = lead + duration + tail;
    // One-shot foley hits: scan the beats for trigger words. One hit per
    // beat, never during a song, 8s cooldown per kind so nothing spams.
    const hits: { kind: Sfx; at: number }[] = [];
    const lastAt: Partial<Record<Sfx, number>> = {};
    for (const b of beats) {
      if (b.song) continue;
      for (const t of SFX_TRIGGERS) {
        if (!t.re.test(b.text)) continue;
        const at = lead + b.start + 0.3;
        if (lastAt[t.kind] !== undefined && at - lastAt[t.kind]! < 8) continue;
        lastAt[t.kind] = at;
        hits.push({ kind: t.kind, at });
        break;
      }
      if (hits.length >= 14) break;
    }
    const raw: { amb: Amb | null; start: number; end: number }[] = [
      { amb: null, start: 0, end: lead },
    ];
    for (const b of beats) {
      const amb = ambFor(b.text, b.frame);
      const start = lead + b.start;
      const end = start + b.dur;
      const prev = raw[raw.length - 1];
      if (prev && (prev.amb === amb || end - start < 5)) prev.end = end;
      else raw.push({ amb, start, end });
    }
    raw[raw.length - 1].end = total;
    // Merge sub-9s slivers into their neighbor so beds don't flicker.
    const windows: { amb: Amb | null; start: number; end: number }[] = [];
    for (const w of raw) {
      const prev = windows[windows.length - 1];
      if (prev && w.end - w.start < 9) prev.end = w.end;
      else windows.push({ ...w });
    }
    if (!windows.some((w) => w.amb) && !hits.length) return null;
    const parts: string[] = [];
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      const len = w.end - w.start;
      if (len <= 0.2) continue;
      const part = `amb_part${i}.wav`;
      if (w.amb) {
        const src = await ensureAmb(w.amb);
        if (!src) return null;
        const fadeOut = Math.max(0.1, len - 1.5);
        const code = await sh("ffmpeg", ["-y", "-stream_loop", "-1", "-i", src, "-t", len.toFixed(3),
          "-af", `afade=t=in:d=1.5,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5,aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo`,
          part], planDir);
        if (code !== 0) return null;
      } else {
        const code = await sh("ffmpeg", ["-y", "-f", "lavfi", "-i",
          `anullsrc=r=44100:cl=stereo`, "-t", len.toFixed(3),
          "-af", "aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo", part], planDir);
        if (code !== 0) return null;
      }
      parts.push(part);
    }
    if (!parts.length) return null;
    fs.writeFileSync(path.join(planDir, "amb_list.txt"), parts.map((p) => `file '${p}'`).join("\n"), "utf8");
    const bedName = hits.length ? "amb_bed.wav" : "ambience.wav";
    const code = await sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "amb_list.txt", "-c", "copy", bedName], planDir);
    for (const p of parts) fs.rmSync(path.join(planDir, p), { force: true });
    fs.rmSync(path.join(planDir, "amb_list.txt"), { force: true });
    if (code !== 0 || !fs.existsSync(path.join(planDir, bedName))) return null;
    // Overlay the one-shots onto the bed at their timestamps. They're boosted
    // well above the bed (the whole track is mixed low under the voice), with
    // a limiter so stacked hits never wrap-clip the 16-bit WAV.
    if (hits.length) {
      const srcs = new Map<Sfx, string>();
      const usable: { src: string; at: number }[] = [];
      for (const h of hits) {
        if (!srcs.has(h.kind)) {
          const s = await ensureSfx(h.kind);
          if (s) srcs.set(h.kind, s);
        }
        const s = srcs.get(h.kind);
        if (s) usable.push({ src: s, at: h.at });
      }
      if (usable.length) {
        const args = ["-y", "-i", "amb_bed.wav"];
        for (const u of usable) args.push("-i", u.src);
        const fc =
          usable.map((u, i) => `[${i + 1}:a]volume=2.4,adelay=${Math.round(u.at * 1000)}:all=1[s${i}]`).join(";") +
          `;[0:a]${usable.map((_, i) => `[s${i}]`).join("")}amix=inputs=${usable.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
        const mix = await sh("ffmpeg", ["-y", ...args, "-filter_complex", fc, "-map", "[a]",
          "-c:a", "pcm_s16le", "ambience.wav"], planDir);
        fs.rmSync(path.join(planDir, "amb_bed.wav"), { force: true });
        if (mix !== 0 || !fs.existsSync(path.join(planDir, "ambience.wav"))) return null;
      } else {
        fs.renameSync(path.join(planDir, "amb_bed.wav"), path.join(planDir, "ambience.wav"));
      }
    }
    return "ambience.wav";
  } catch {
    return null;
  }
}

/**
 * Build the film's score: mood windows from the beats (in film time, i.e.
 * including the title-card lead), theme over the open and close, cues looped,
 * faded and concatenated into score.wav inside the plan dir.
 */
// Score v2 cue labels: moods plus the sing-along pulse and musical rests.
type ScoreCue = Mood | "song" | "quiet";

// Call-and-response holds — the score rests so kids answer into quiet.
const SCORE_INTERACT_RE =
  /say it (out loud|with me)|i'?ll wait|we'?ll wait|shout it|got it\?|do you have (it|them) in your mind/i;
// The film's biggest lines get two seconds of silence first, then a bloom —
// nothing makes a miracle land like the music holding its breath.
const CLIMAX_RE =
  /\bpeace\.?,? be still\b|let there be light|your faith has made you|today,? salvation|and he answered me|it is very good|rise,? and go your way/i;

export async function buildScore(
  planDir: string,
  beats: { text: string; start: number; dur: number; song?: boolean }[],
  duration: number,
  lead: number,
  tail: number,
  motifs?: { at: number; who: string }[]
): Promise<string | null> {
  try {
    const total = lead + duration + tail;
    // Cue windows from beats: song runs get the clap pulse, interactive
    // holds get silence, everything else its mood; blips join neighbors.
    const raw: { cue: ScoreCue; start: number; end: number }[] = [];
    for (const b of beats) {
      const cue: ScoreCue = b.song
        ? "song"
        : SCORE_INTERACT_RE.test(b.text)
          ? "quiet"
          : moodFor(b.text);
      const start = lead + b.start;
      const end = start + b.dur;
      const prev = raw[raw.length - 1];
      if (prev && (prev.cue === cue || (end - start < 6 && cue !== "quiet"))) prev.end = end;
      else raw.push({ cue, start, end });
    }
    const windows: { cue: ScoreCue; start: number; end: number }[] = [];
    for (const w of raw) {
      const prev = windows[windows.length - 1];
      // Short blips merge into the neighbor — but a quiet window stays quiet
      // even when short: that IS the point of it.
      if (prev && w.end - w.start < 12 && w.cue !== "quiet" && prev.cue !== "quiet") prev.end = w.end;
      else windows.push({ ...w });
    }
    // Theme bookends.
    const openEnd = Math.min(lead + 35, total);
    const closeStart = Math.max(openEnd, total - 30);
    const mids = windows
      .map((w) => ({ ...w, start: Math.max(w.start, openEnd), end: Math.min(w.end, closeStart) }))
      .filter((w) => w.end - w.start >= (w.cue === "quiet" ? 2 : 8));
    const final: { cue: ScoreCue; start: number; end: number }[] = [
      { cue: "theme", start: 0, end: openEnd },
      ...mids,
      { cue: "theme", start: closeStart, end: total },
    ];
    // Close gaps so parts concat into a continuous track.
    for (let i = 1; i < final.length; i++) final[i].start = final[i - 1].end;
    final[final.length - 1].end = total;

    // Pre-climax silence: carve a 2s rest right before each climax beat
    // (max two per film, min 60s apart), splitting whatever window holds it.
    const climaxAts: number[] = [];
    for (const b of beats) {
      if (!CLIMAX_RE.test(b.text)) continue;
      const at = lead + b.start;
      if (climaxAts.length >= 2 || (climaxAts.length && at - climaxAts[climaxAts.length - 1] < 60)) continue;
      climaxAts.push(at);
    }
    let carved = final;
    for (const at of climaxAts) {
      const s = Math.max(0, at - 2);
      const next: typeof final = [];
      for (const w of carved) {
        if (w.end <= s || w.start >= at) { next.push(w); continue; }
        if (w.start < s) next.push({ ...w, end: s });
        next.push({ cue: "quiet", start: Math.max(w.start, s), end: Math.min(w.end, at) });
        if (w.end > at) next.push({ ...w, start: at });
      }
      carved = next.filter((w) => w.end - w.start > 0.05);
    }

    const parts: string[] = [];
    for (let i = 0; i < carved.length; i++) {
      const w = carved[i];
      const len = w.end - w.start;
      if (len <= 0.5 && w.cue !== "quiet") continue;
      const part = `score_part${i}.wav`;
      if (w.cue === "quiet") {
        const code = await sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
          "-t", len.toFixed(3), "-af", "aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo", part], planDir);
        if (code !== 0) return null;
      } else {
        const cueWav = (await ensureCue(w.cue)) ?? (await ensureCue("shepherd"));
        if (!cueWav) return null;
        const fadeOut = Math.max(0.1, len - 1.5);
        const code = await sh(
          "ffmpeg",
          ["-y", "-stream_loop", "-1", "-i", cueWav, "-t", len.toFixed(3),
           "-af", `afade=t=in:d=1.0,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5,aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo`,
           part],
          planDir
        );
        if (code !== 0) return null;
      }
      parts.push(part);
    }
    if (!parts.length) return null;
    fs.writeFileSync(path.join(planDir, "score_list.txt"), parts.map((p) => `file '${p}'`).join("\n"), "utf8");
    const bedName = "score_bed.wav";
    const code = await sh(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", "score_list.txt", "-c", "copy", bedName],
      planDir
    );
    for (const p of parts) fs.rmSync(path.join(planDir, p), { force: true });
    fs.rmSync(path.join(planDir, "score_list.txt"), { force: true });
    if (code !== 0 || !fs.existsSync(path.join(planDir, bedName))) return null;

    // Overlays: miracle stingers where light breaks (and at each climax, right
    // ON the line after its silence), and character motifs at first lines.
    const hits: { wav: string; at: number; vol: number }[] = [];
    const sparkleRe = SFX_TRIGGERS.find((t) => t.kind === "sparkle")!.re;
    let lastSting = -999;
    for (const b of beats) {
      if (b.song) continue;
      const at = lead + b.start;
      if ((sparkleRe.test(b.text) || climaxAts.includes(at)) && at - lastSting >= 20) {
        lastSting = at;
        const w = await ensureCue("stinger");
        if (w) hits.push({ wav: w, at, vol: 0.9 });
        if (hits.length >= 6) break;
      }
    }
    for (const m of motifs ?? []) {
      const w = await ensureCue(`motif_${m.who}`);
      if (w) hits.push({ wav: w, at: lead + m.at, vol: 0.8 });
    }
    if (!hits.length) {
      fs.renameSync(path.join(planDir, bedName), path.join(planDir, "score.wav"));
      return "score.wav";
    }
    const args = ["-y", "-i", bedName];
    for (const h of hits) args.push("-i", h.wav);
    const fc =
      hits.map((h, i) => `[${i + 1}:a]volume=${h.vol},adelay=${Math.round(h.at * 1000)}:all=1[s${i}]`).join(";") +
      `;[0:a]${hits.map((_, i) => `[s${i}]`).join("")}amix=inputs=${hits.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
    const mix = await sh("ffmpeg", ["-y", ...args, "-filter_complex", fc, "-map", "[a]", "-c:a", "pcm_s16le", "score.wav"], planDir);
    fs.rmSync(path.join(planDir, bedName), { force: true });
    if (mix !== 0 || !fs.existsSync(path.join(planDir, "score.wav"))) return null;
    return "score.wav";
  } catch {
    return null;
  }
}

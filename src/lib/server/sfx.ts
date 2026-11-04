/**
 * The foley layer: per-beat sound effects (sandals on stone, wind over the
 * ridge, the sling's whoosh) generated via ElevenLabs Sound Effects from a
 * cheap LLM read of each beat, cached by description, and pre-mixed with the
 * series' 4-note shadow motif into ONE effects track the splicer adds as a
 * single input. Best-effort everywhere: no key, no credits, no track — the
 * film still ships exactly as before.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolveField } from "./integrations";
import { llmComplete } from "./generate";
import type { FilmBeat } from "./render";

const MUSIC_DIR = path.join(process.cwd(), "data", "renders", "music");
const SFX_CACHE = path.join(MUSIC_DIR, "sfx");

const SFX_SCHEMA = {
  type: "object",
  properties: {
    sfx: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          desc: { type: ["string", "null"] },
        },
        required: ["i", "desc"],
        additionalProperties: false,
      },
    },
  },
  required: ["sfx"],
  additionalProperties: false,
};

async function elSound(key: string, text: string, seconds: number): Promise<Buffer | null> {
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, duration_seconds: Math.min(10, Math.max(1, seconds)), prompt_influence: 0.35 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 2_000 ? buf : null;
  } catch {
    return null;
  }
}

function cached(key: string, desc: string, seconds: number): Promise<string | null> {
  const hash = crypto.createHash("sha1").update(`${desc}|${Math.round(seconds)}`).digest("hex").slice(0, 14);
  const file = path.join(SFX_CACHE, `${hash}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 2_000) return Promise.resolve(file);
  return elSound(key, desc, seconds).then((buf) => {
    if (!buf) return null;
    fs.mkdirSync(SFX_CACHE, { recursive: true });
    fs.writeFileSync(file, buf);
    return file;
  });
}

/** The 4-note shadow motif — composed once, reused forever (the series bible's
 *  vignette ritual sound). */
async function ensureMotif(key: string): Promise<string | null> {
  const file = path.join(MUSIC_DIR, "el_motif.mp3");
  if (fs.existsSync(file) && fs.statSync(file).size > 2_000) return file;
  const buf = await elSound(
    key,
    "A single gentle heavenly four-note ascending chime motif, harp and celesta, warm and reverent, one short phrase then silence, no other instruments",
    5
  );
  if (!buf) return null;
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

const directionOfLocal = (s: string) =>
  (s.match(/\[\[([^\]]*)\]\]/g) ?? []).map((m) => m.slice(2, -2)).join(". ");

/**
 * Build planDir/sfxtrack.mp3 for the film: foley on story beats + the shadow
 * motif on Jesus-vignette beats, each delayed to its beat start, mixed into
 * one track of film length. Returns the track filename or null.
 */
const LEITMOTIF_INSTRUMENTS = ["wooden flute", "folk harp", "soft warm strings", "gentle French horn", "kalimba", "lyre"];

/** A character's 3-second signature phrase — composed once, reused in every
 *  episode they enter (instrument chosen deterministically from the name). */
async function ensureLeitmotif(key: string, name: string): Promise<string | null> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
  const file = path.join(MUSIC_DIR, `leitmotif-${slug}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 2_000) return file;
  const inst =
    LEITMOTIF_INSTRUMENTS[
      crypto.createHash("sha1").update(name.toLowerCase()).digest()[0] % LEITMOTIF_INSTRUMENTS.length
    ];
  const buf = await elSound(
    key,
    `A warm gentle 3-second ${inst} musical phrase — a storybook character's signature motif, one single melodic line, folk and tender, no percussion, no other instruments`,
    3
  );
  if (!buf) return null;
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

export async function ensureFilmSfx(
  planDir: string,
  beats: FilmBeat[],
  lead: number,
  total: number,
  castNames: string[] = []
): Promise<string | null> {
  const key = resolveField("voiceover", "elevenlabsApiKey");
  if (!key) return null;

  // 1. Which beats want foley: story beats (not fireside, not sung).
  const candidates = beats.filter(
    (b) => (b as { frame?: boolean }).frame !== true && b.song !== true && b.dur >= 2.5
  );
  const descs = new Map<number, string>();
  for (let at = 0; at < candidates.length; at += 50) {
    const chunk = candidates.slice(at, at + 50);
    const res = await llmComplete(
      'For each numbered animated-storybook scene, give ONE short concrete sound-effect description (max 9 words: physical sounds only — footsteps, wind, water, fire, animals, fabric, stone; NEVER music, NEVER voices or speech) or null where silence serves the scene better. Foley should be occasional, not constant: return null for at least half. Return JSON {"sfx":[{"i":<scene number>,"desc":<string or null>}]}.',
      chunk.map((b) => `#${b.i}: ${b.text.replace(/\[\[[^\]]*\]\]/g, " ").slice(0, 90)}`).join("\n"),
      SFX_SCHEMA as unknown as Record<string, unknown>,
      { tier: "fast", maxTokens: 1800, context: "sfx" }
    ).catch(() => null);
    if (!res) continue;
    try {
      for (const s of (JSON.parse(res.text) as { sfx: { i: number; desc: string | null }[] }).sfx) {
        if (s.desc && s.desc.length > 3) descs.set(s.i, s.desc.slice(0, 80));
      }
    } catch {
      /* skip chunk */
    }
  }

  // 2. Generate/cache each effect; collect overlay entries.
  const overlays: { file: string; at: number; vol: number }[] = [];
  for (const b of candidates) {
    const d = descs.get(b.i);
    if (!d) continue;
    const f = await cached(key, d, Math.min(8, b.dur));
    if (f) overlays.push({ file: f, at: lead + b.start + 0.2, vol: 0.9 });
  }
  // 3. The shadow motif on Jesus-vignette beats (series-bible ritual).
  const motifBeats = beats.filter((b) => {
    const dir = directionOfLocal(b.text);
    return /vignette|thought.?bubble/i.test(dir) && /jesus/i.test(dir);
  });
  if (motifBeats.length) {
    const motif = await ensureMotif(key);
    if (motif) for (const b of motifBeats) overlays.push({ file: motif, at: lead + b.start + 0.4, vol: 1.0 });
  }
  // Character leitmotifs: each major's signature phrase under their FIRST
  // story entrance — the audience learns who's arriving before Naomi says it.
  for (const name of castNames.slice(0, 4)) {
    if (name.length < 3) continue;
    const entrance = beats.find(
      (b) => (b as { frame?: boolean }).frame !== true && b.text.toLowerCase().includes(name.toLowerCase())
    );
    if (!entrance) continue;
    const f = await ensureLeitmotif(key, name);
    if (f) overlays.push({ file: f, at: lead + entrance.start + 0.3, vol: 0.55 });
  }
  if (!overlays.length) return null;

  // 4. Pre-mix everything into one film-length track.
  const args: string[] = ["-y", "-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=44100:cl=stereo"];
  const parts: string[] = [];
  const labels: string[] = ["[0:a]"];
  overlays.slice(0, 60).forEach((o, k) => {
    args.push("-i", o.file);
    parts.push(`[${k + 1}:a]volume=${o.vol},adelay=${Math.round(o.at * 1000)}:all=1,apad[s${k}];`);
    labels.push(`[s${k}]`);
  });
  const fc =
    parts.join("") +
    `${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0,atrim=0:${total.toFixed(3)}[a]`;
  const r = spawnSync(
    "ffmpeg",
    [...args, "-filter_complex", fc, "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "4", "sfxtrack.mp3"],
    { cwd: planDir, stdio: ["ignore", "ignore", "pipe"] }
  );
  if (r.status !== 0) {
    console.error("[sfx] track mix failed:", String(r.stderr).slice(-200));
    return null;
  }
  console.log(`[sfx] effects track built: ${overlays.length} sounds (${descs.size} foley, ${motifBeats.length} motif)`);
  return "sfxtrack.mp3";
}

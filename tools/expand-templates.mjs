// Template expander + canon linter: run on every episode script BEFORE the
// Brain Trust. Expands {{TOKENS}} into the series bible's locked text so the
// vignette, Thread, and liturgy can never drift across 53 episodes, then
// lints the structural canon rules.
//   node tools/expand-templates.mjs <script.txt>          (lint + expand in place)
//   node tools/expand-templates.mjs <script.txt> --check  (lint only)
import fs from "node:fs";

const FILE = process.argv[2];
const CHECK = process.argv.includes("--check");
if (!FILE || !fs.existsSync(FILE)) {
  console.error("usage: node tools/expand-templates.mjs <script.txt> [--check]");
  process.exit(1);
}
let text = fs.readFileSync(FILE, "utf8");

// ---- Locked templates (series-bible.md is the source of truth) ----
const JESUS_DESIGN =
  "Jesus — deep warm tan, sun-browned Middle-Eastern skin, dark wavy hair and beard, simple cream robes, a calm kind loving face";
const VIGNETTE = (object, thorns) =>
  `[[Floating golden dream-vignette glowing in the warm air above the clay lamp: ${JESUS_DESIGN}${thorns ? " — wearing a simple woven crown of thorns" : ""} — holding/with ${object}, soft golden radiance all around Him; the fireside cast gaze up at it in wonder.]]`;
const THREAD_STATES = {
  s1: "hair-thin, barely there, flickering softly",
  s2: "thin but steady, faintly brighter at this covenant moment",
  s3: "clearly visible and continuous through the camp",
  s4: "a confident unbroken line, warm and calm",
  s5: "a confident unbroken line, warm and calm",
  s6: "visibly thinner now — but never broken",
  s7: "thin in the dark, holding",
  blazing: "rising blazing and continuous, the brightest it has ever been",
};
const THREAD = (era) =>
  `[[The Promise Thread: a thin glowing golden filament with a faint crimson edge drifts gently from the lamp toward the horizon — ${THREAD_STATES[era] ?? THREAD_STATES.s2} — never touching the characters, always softer than the lamp's own light.]]`;
const LITURGY = `NAOMI: Little ones! The stars are out, the night is soft... so tell me — who lights the lamp?
ELI: WE light the lamp!
PIP: Ooooh... watch it glow!`;
const HOOK = `ELI: Your word is a lamp for my feet!
PIP: A light for my path so sweet!
ELI: When the road is dark and long —
PIP: Light the lamp and sing along!`;

// ---- Expansion ----
const before = text;
text = text.replace(/\{\{VIGNETTE:([^}|]+)(\|thorns)?\}\}/g, (_, obj, th) => VIGNETTE(obj.trim(), Boolean(th)));
text = text.replace(/\{\{THREAD:(\w+)\}\}/g, (_, era) => THREAD(era.toLowerCase()));
text = text.replace(/\{\{LITURGY\}\}/g, LITURGY);
text = text.replace(/\{\{HOOK\}\}/g, HOOK);
const expanded = text !== before;

// ---- Lint ----
const problems = [];
const warn = (s) => problems.push(s);
if (!/^#\s*ARC\s*[—-]/m.test(text)) warn("Missing # ARC — WANT/NEED/TURN/TEAR-BEAT header.");
if (!/^#\s*CAST\s*[—-]/m.test(text)) warn("No # CAST blocks (copy them from scripts/cast-book.md).");
const vignettes = (text.match(/Floating golden dream-vignette/g) ?? []).length;
if (vignettes > 1) warn(`${vignettes} vignettes — the bible allows ONE Primary per episode.`);
if (/\bknife|blade|dagger\b/i.test(text)) warn("Weapon word found — forbidden under Akedah/dignity rules.");
if (/crown of thorns/i.test(text) && !/ram|passover|atonement|lamb of god/i.test(text))
  warn("Crown of thorns outside a sacrifice-shadow context.");
if (!/Who lights the lamp|who lights the lamp/.test(text)) warn("Lamp liturgy missing ({{LITURGY}}).");
if (!/lamp for my feet/i.test(text)) warn("Psalm 119:105 hook missing ({{HOOK}}).");
if (!/quiz time|shout it out/i.test(text)) warn("Quiz segment missing.");
if (!/chapter\s+\w+,?\s+verse|verse\s+\w+/i.test(text)) warn("Memory verse (book, chapter, verse) not spoken.");
if (!/next time|follow for the next/i.test(text)) warn("Tease / sign-off missing.");
const unexpanded = text.match(/\{\{[A-Z]+[^}]*\}\}/g);
if (unexpanded) warn(`Unknown template token(s): ${unexpanded.join(", ")}`);

if (!CHECK && expanded) fs.writeFileSync(FILE, text, "utf8");
console.log(expanded && !CHECK ? "Templates expanded in place." : "No expansion needed.");
if (problems.length) {
  console.log(`LINT: ${problems.length} problem(s):`);
  for (const p of problems) console.log("  - " + p);
  process.exit(2);
}
console.log("LINT: clean — ready for the Brain Trust.");

// The Brain Trust: every episode script faces three critics and a synthesis
// verdict BEFORE it renders — Pixar's most copied practice, automated.
//   node brain-trust.mjs <script.txt>
// Writes <script>.critique.md and prints the verdict. Runs on the server
// (uses the app's encrypted xAI key). Read-only: never edits the script.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SCRIPT_PATH = process.argv[2];
if (!SCRIPT_PATH || !fs.existsSync(SCRIPT_PATH)) {
  console.error("usage: node brain-trust.mjs <script.txt>");
  process.exit(1);
}
const APP = "/home/echoforge/app";
const script = fs.readFileSync(SCRIPT_PATH, "utf8");

const db = new DatabaseSync(path.join(APP, "data/echoforge.db"), { readOnly: true });
const row = db.prepare("SELECT config FROM integrations WHERE name='llm'").get();
const secret = fs.readFileSync(path.join(APP, ".env"), "utf8").match(/SESSION_SECRET=(.+)/)[1].trim();
const kk = crypto.createHash("sha256").update(secret + ":integrations:v1").digest();
const [iv, tag, ct] = String(row.config).replace(/^enc1:/, "").split(":");
const dc = crypto.createDecipheriv("aes-256-gcm", kk, Buffer.from(iv, "base64"));
dc.setAuthTag(Buffer.from(tag, "base64"));
const KEY = JSON.parse(Buffer.concat([dc.update(Buffer.from(ct, "base64")), dc.final()]).toString()).xaiApiKey;

async function critic(name, system) {
  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-4",
      messages: [
        { role: "system", content: system },
        { role: "user", content: script.slice(0, 24000) },
      ],
      max_tokens: 900,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "(no response)";
}

const CANON = `Series rules this script MUST obey:
- Begins with production notes: an "# ARC —" header (WANT / NEED / TURN / TEAR-BEAT) and "# CAST" blocks for its STORY characters only. (The fireside trio — Naomi, Eli, Pip — are platform personas and never need # CAST blocks; do not flag them.)
- Lamp liturgy intro with the Psalm 119:105 hook; one treasure-box aside; quiz; memory verse; tease at the end.
- Christ-shadows: at most ONE Primary per episode, only entries from the Scarlet Thread table, the exact NT anchor spoken aloud, the vignette carried by the locked [[...]] direction template (Jesus never inside the OT scene; Daniel 3 alone is an in-scene light-wrapped Christophany, face unseen).
- Akedah safe framing: no weapon ever shown or described; children pre-assured God will provide.
- Bronze serpent: mounted on a CROSS-SHAPED standard (the one sanctioned cross silhouette).
- [[Thread]] at promise moments per era thickness. [[...]] directions silent; camera words never in spoken lines.
- Child-safe always: no gore, no horror, sorrow handled with dignity.`;

const critics = [
  ["STORY EDITOR", `You are a veteran story editor running a Pixar-style brain trust on a children's Bible episode script. Judge STORY: Does the hero have a clear WANT and a deeper NEED, and does the script's # ARC header match what the scenes actually deliver? Is the emotional turn earned? Is there a true tear-beat around 65-75%? Is the lesson FELT in the story before Naomi says it? Where does pacing die? Is the cold open a 3-second hook? Does the tease create pull? Be specific with line quotes. End with: SCORE: n/10 and your TOP 5 fixes, ranked.`],
  ["THE KIDS' ROOM", `You are the voice of a room of 4-8 year olds watching this script. Judge WATCHABILITY: where do kids laugh (are there at least two genuine laugh beats)? What's the one line a child will repeat to a parent — does it exist? Which words are too big? Which stretch of narration runs too long without a child's voice or a picture-change (flag anything over ~45 spoken seconds)? Does the quiz feel like a game or a test? Be concrete. End with: SCORE: n/10 and your TOP 5 fixes, ranked.`],
  ["THE CANON KEEPER", `You are the series' theological and continuity reviewer. Check this script against the rules below, item by item, quoting violations exactly. Also check scripture faithfulness: nothing invented that contradicts the text, references accurate, names/meanings correct.\n\n${CANON}\n\nEnd with: VERDICT: COMPLIANT or VIOLATIONS FOUND, then the list.`],
];

console.log(`Brain Trust convening on ${path.basename(SCRIPT_PATH)} (${script.split(/\s+/).length} words)…`);
const reports = [];
for (const [name, sys] of critics) {
  process.stdout.write(`  ${name}… `);
  try {
    const out = await critic(name, sys);
    reports.push(`## ${name}\n\n${out}`);
    console.log("done");
  } catch (e) {
    reports.push(`## ${name}\n\n(unavailable: ${e.message})`);
    console.log("FAILED");
  }
}
process.stdout.write("  SYNTHESIS… ");
let synthesis = "";
try {
  synthesis = await critic(
    "SYNTHESIS",
    `You are the director synthesizing a brain-trust session. Below are three critics' reports on the script the user supplies. Merge them into: (1) a one-line overall verdict — READY TO RENDER or REVISE FIRST; (2) the five highest-impact revisions across all reports, ranked, each one actionable in a single edit; (3) one sentence on the script's greatest strength (protect it in revision). Reports:\n\n${reports.join("\n\n")}`
  );
  console.log("done");
} catch (e) {
  synthesis = `(synthesis unavailable: ${e.message})`;
  console.log("FAILED");
}

const out = `# Brain Trust — ${path.basename(SCRIPT_PATH)}\n_${new Date().toISOString()}_\n\n## VERDICT & TOP FIXES\n\n${synthesis}\n\n---\n\n${reports.join("\n\n---\n\n")}\n`;
const outPath = SCRIPT_PATH.replace(/\.txt$/, "") + ".critique.md";
fs.writeFileSync(outPath, out, "utf8");
console.log(`\n${synthesis.split("\n").slice(0, 12).join("\n")}\n\nFull critique: ${outPath}`);

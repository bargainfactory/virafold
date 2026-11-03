// Master Pass, local side: pull a rendered film's visual sources from the
// server, upscale them 2x on this machine's NVIDIA GPU (Real-ESRGAN), push
// them back, and trigger the server-side re-encode + resplice.
//
//   node tools/master-pass.mjs <clipId> [--limit N]
//
// Requires: ssh key at ~/.ssh/echoforge_vultr, ffmpeg on PATH, and the
// realesrgan-ncnn-vulkan portable build in tools/realesrgan-dl/x/.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID = process.argv[2];
const LIMIT = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
if (!ID) { console.error("usage: node tools/master-pass.mjs <clipId> [--limit N]"); process.exit(1); }

const HOST = "root@45.76.15.204";
const KEY = path.join(os.homedir(), ".ssh", "echoforge_vultr");
const RDIR = `/home/echoforge/app/data/renders/plan-${ID}`;
const ESRGAN = path.join(HERE, "realesrgan-dl", "x", "realesrgan-ncnn-vulkan.exe");
const WORK = path.join(HERE, "master-work", ID);
const IN = path.join(WORK, "in");
const OUTD = path.join(WORK, "out");
for (const d of [IN, OUTD]) fs.mkdirSync(d, { recursive: true });

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-300)}`);
  return r.stdout;
}
const ssh = (remote) => sh("ssh", ["-i", KEY, HOST, remote]);
// Git Bash tar needs forward slashes, not C:\ backslashes.
const posix = (p) => p.replace(/\\/g, "/");

// 1. The plan tells us which files the film actually shows.
console.log("1/5 reading plan…");
fs.writeFileSync(path.join(WORK, "plan.json"), ssh(`cat ${RDIR}/plan.json`));
const plan = JSON.parse(fs.readFileSync(path.join(WORK, "plan.json"), "utf8"));
let files = [...new Set(plan.beats.map((b) => b.file))].filter((f) => /\.(png|jpg|mp4)$/.test(f));
if (files.length > LIMIT) files = files.slice(0, LIMIT);
console.log(`   ${files.length} sources (${files.filter((f) => f.endsWith(".mp4")).length} videos)`);

// 2. Pull them in one tar stream.
console.log("2/5 pulling sources…");
sh("bash", ["-c", `ssh -i "${posix(KEY)}" ${HOST} "tar -C ${RDIR} -czf - ${files.map((f) => `'${f}'`).join(" ")}" | tar -xzf - -C "${posix(IN)}"`]);

// 3. Upscale: stills straight through; videos via frame explode → GPU → reassemble.
console.log("3/5 upscaling on GPU…");
const t0 = Date.now();
const stills = files.filter((f) => !f.endsWith(".mp4"));
if (stills.length) {
  const sdir = path.join(WORK, "stills");
  fs.mkdirSync(sdir, { recursive: true });
  for (const f of stills) fs.copyFileSync(path.join(IN, f), path.join(sdir, f));
  sh(ESRGAN, ["-i", sdir, "-o", OUTD, "-n", "realesr-animevideov3", "-s", "2", "-g", "1"]);
  for (const f of stills) fs.renameSync(path.join(OUTD, f), path.join(OUTD, `up_${f}`));
  console.log(`   ${stills.length} stills done`);
}
const vids = files.filter((f) => f.endsWith(".mp4"));
for (let i = 0; i < vids.length; i++) {
  const f = vids[i];
  const fdir = path.join(WORK, "frames");
  const udir = path.join(WORK, "uframes");
  fs.rmSync(fdir, { recursive: true, force: true });
  fs.rmSync(udir, { recursive: true, force: true });
  fs.mkdirSync(fdir, { recursive: true });
  fs.mkdirSync(udir, { recursive: true });
  sh("ffmpeg", ["-y", "-v", "error", "-i", path.join(IN, f), path.join(fdir, "f%05d.png")]);
  sh(ESRGAN, ["-i", fdir, "-o", udir, "-n", "realesr-animevideov3", "-s", "2", "-g", "1", "-j", "4:4:4"]);
  sh("ffmpeg", ["-y", "-v", "error", "-framerate", "30", "-i", path.join(udir, "f%05d.png"),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-an", path.join(OUTD, `up_${f}`)]);
  console.log(`   video ${i + 1}/${vids.length} (${f})`);
}
console.log(`   GPU time ${(Date.now() - t0) / 60000 | 0} min`);

// 4. Push everything back in one stream.
console.log("4/5 pushing upscaled sources…");
const ups = fs.readdirSync(OUTD).filter((f) => f.startsWith("up_"));
sh("bash", ["-c", `tar -C "${posix(OUTD)}" -czf - ${ups.map((f) => `'${f}'`).join(" ")} | ssh -i "${posix(KEY)}" ${HOST} "tar -xzf - -C ${RDIR} && chown echoforge:echoforge ${RDIR}/up_*"`]);

// 5. Server re-encodes the touched segments and resplices.
console.log("5/5 server re-encode + resplice…");
console.log(ssh(`cd /home/echoforge/app && sudo -u echoforge node /home/echoforge/master-encode.mjs ${ID}`).trim());
console.log("MASTER PASS COMPLETE");

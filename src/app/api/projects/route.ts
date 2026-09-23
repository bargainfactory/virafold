import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getSessionUser } from "@/lib/server/auth";
import {
  bestPlanFor,
  countProjectsSince,
  createProjectWithAssets,
  getBrandVoice,
  getFlags,
  insertNotification,
  listProjects,
  setProjectMedia,
  setProvenance,
  topPerformers,
  type TranscriptWord,
} from "@/lib/server/db";
import { auditExemplars } from "@/lib/server/audit";
import { fetchArticleText } from "@/lib/server/article";
import { watchExemplars } from "@/lib/server/watch";
import { generateAssets } from "@/lib/server/generate";
import { PLAN_MONTHLY_PROJECTS } from "@/lib/server/pricing";
import { createManifest, signManifest } from "@/lib/server/provenance";
import { rateLimit } from "@/lib/server/rate-limit";
import { transcribeMedia } from "@/lib/server/transcribe";
import type { BrandVoice } from "@/lib/data";

/** True when any profile field would actually steer generation. */
function voiceIsActive(v: BrandVoice): boolean {
  return Boolean(
    v.tone || v.audience || v.cta || v.hashtags || v.bannedWords || v.signature || !v.emojis
  );
}

export const dynamic = "force-dynamic";

// Cap the raw upload we persist to disk (the transcript, not the media, drives
// generation — so a large media file is stored for reference only).
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
// Reject the whole request body before it is buffered into memory. Allows some
// multipart overhead above the single-file cap.
const MAX_REQUEST_BYTES = 220 * 1024 * 1024; // 220 MB
// Each generation may invoke a paid LLM call; bound per-account spend/abuse.
const GEN_LIMIT = 20;
const GEN_WINDOW_MS = 60 * 60 * 1000; // per hour

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ projects: listProjects(user.email) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Operator kill switch — lets an admin halt all (potentially paid) generation
  // platform-wide without a redeploy.
  if (!getFlags().generationEnabled) {
    return NextResponse.json(
      { error: "Generation is temporarily disabled by the operator" },
      { status: 503 }
    );
  }

  const gate = rateLimit(`gen:${user.email}`, GEN_LIMIT, GEN_WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Generation limit reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  // Plan quota: monthly project generations, checked against the live DB plan
  // (the session's copy can be stale after a Stripe-webhook upgrade). Managed
  // client accounts inherit their agency's plan while the link is active.
  const plan = bestPlanFor(user.email);
  const cap = PLAN_MONTHLY_PROJECTS[plan] ?? PLAN_MONTHLY_PROJECTS.Starter;
  if (Number.isFinite(cap)) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const used = countProjectsSince(user.email, monthStart.toISOString());
    if (used >= cap) {
      // Episode Kit bonus projects cover overage one project at a time.
      const { consumeBonusProject } = await import("@/lib/server/db");
      if (!consumeBonusProject(user.email)) {
        return NextResponse.json(
          {
            error: `Monthly limit reached — the ${plan} plan includes ${cap} project${cap === 1 ? "" : "s"} per month. Upgrade to keep generating.`,
          },
          { status: 402 }
        );
      }
      insertNotification(user.email, {
        id: `n-${crypto.randomUUID()}`,
        title: "Bonus project used",
        message: "This project ran on an Episode Kit bonus credit instead of your monthly plan quota.",
        time: "Just now",
        read: false,
        type: "info",
      });
    }
  }

  // Reject an oversized body before Next buffers it (multipart is parsed fully
  // into memory), rather than after.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Request exceeds the 200 MB upload limit for this demo" },
      { status: 413 }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  let title = "";
  let transcript = "";
  let locale = "en";
  let fileName: string | undefined;
  let fileSize: string | undefined;
  let storagePath: string | undefined;
  let transcribedBy: string | undefined;
  let transcriptWords: TranscriptWord[] | null = null;
  let durationSec: number | null = null;
  let sourceUrl = "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    title = String(form.get("title") ?? "").trim();
    transcript = String(form.get("transcript") ?? "").trim();
    locale = String(form.get("locale") ?? "en").slice(0, 8);
    sourceUrl = String(form.get("sourceUrl") ?? "").trim();
    const file = form.get("file");
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const f = file as File;
      if (f.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: "File exceeds the 200 MB upload limit for this demo" },
          { status: 413 }
        );
      }
      fileName = f.name;
      fileSize = `${(f.size / (1024 * 1024)).toFixed(1)} MB`;
      const bytes = Buffer.from(await f.arrayBuffer());
      // Persist the real bytes under data/uploads/<user>/<project>/.
      try {
        const dir = path.join(
          process.cwd(),
          "data",
          "uploads",
          Buffer.from(user.email).toString("hex").slice(0, 24)
        );
        fs.mkdirSync(dir, { recursive: true });
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.bin";
        const dest = path.join(dir, `${Date.now()}-${safe}`);
        fs.writeFileSync(dest, bytes);
        storagePath = path.relative(process.cwd(), dest);
      } catch {
        /* storage is best-effort; generation still proceeds */
      }
      // No pasted transcript → transcribe the media itself when a provider is
      // connected, so generation runs off what was actually said in the file.
      if (!transcript) {
        const tr = await transcribeMedia(bytes, f.name, f.type);
        if (tr) {
          transcript = tr.text;
          transcribedBy = tr.provider;
          // Word timestamps + duration feed Clip Studio's highlight detection
          // and caption burning.
          transcriptWords = tr.words;
          durationSec = tr.durationSec;
        }
      }
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    title = String(b?.title ?? "").trim();
    transcript = String(b?.transcript ?? "").trim();
    locale = String(b?.locale ?? "en").slice(0, 8);
    fileName = b?.fileName ? String(b.fileName) : undefined;
    fileSize = b?.fileSize ? String(b.fileSize) : undefined;
    sourceUrl = b?.sourceUrl ? String(b.sourceUrl).trim() : "";
  }

  // Wider input mouth: an article/blog URL becomes the source transcript.
  if (!transcript && sourceUrl) {
    const article = await fetchArticleText(sourceUrl);
    if (!article) {
      return NextResponse.json(
        { error: "Could not read that URL — check the link (articles and blog posts work best)" },
        { status: 422 }
      );
    }
    transcript = article.text;
    if (!title) title = article.title.slice(0, 120);
  }

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // Real generation from the actual input content, in the user's language,
  // steered by the account's brand-voice profile and their proven winners —
  // both recorded post results and historical winners from their social audit.
  const voice = getBrandVoice(user.email);
  const exemplars = [
    ...topPerformers(user.email, 5).map((p) => p.assetName),
    ...auditExemplars(user.email),
    // Niche swipe file: proven winners from watched competitor channels.
    ...watchExemplars(user.email, 2),
  ].slice(0, 6);
  const { assets: generated, engine } = await generateAssets(
    title,
    transcript,
    locale,
    voice,
    exemplars
  );

  const { project, assets } = createProjectWithAssets(
    user.email,
    {
      id: `proj-${crypto.randomUUID()}`,
      title,
      fileName,
      fileSize,
      transcript: transcript || undefined,
      storagePath,
    },
    generated
  );

  if (transcriptWords || durationSec) {
    setProjectMedia(user.email, project.id, {
      words: transcriptWords,
      durationSec,
    });
  }

  // Signed provenance manifest per asset: source hash, engine, action trail.
  const sourceText = `${title}\n${transcript}`;
  const now = new Date().toISOString();
  for (const a of assets) {
    const manifest = createManifest({
      assetId: a.id,
      projectId: project.id,
      content: a.content ?? "",
      sourceText,
      locale,
      voiceApplied: voiceIsActive(voice),
      firstAction: { action: "generated", at: now, engine },
    });
    setProvenance(a.id, JSON.stringify(manifest), signManifest(manifest));
  }

  if (transcribedBy) {
    insertNotification(user.email, {
      id: `n-${crypto.randomUUID()}`,
      title: "Media Transcribed",
      message: `"${fileName}" was transcribed automatically (${transcribedBy}) and drove this generation.`,
      time: "Just now",
      read: false,
      type: "info",
    });
  }

  insertNotification(user.email, {
    id: `n-${crypto.randomUUID()}`,
    title: "Assets Ready for Review",
    message: `"${project.title}" generated ${assets.length} assets — ready to review.`,
    time: "Just now",
    read: false,
    type: "success",
  });

  return NextResponse.json({ project, assets }, { status: 201 });
}

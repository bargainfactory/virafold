"use client";

/**
 * The six free tools' interactive UIs, switched by slug. English marketing
 * surface. Deterministic/client-side wherever possible so anonymous traffic
 * costs nothing; only the hook analyzer and channel compare touch the server.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Loader2,
  Sparkles,
  Swords,
} from "lucide-react";
import { track } from "@/lib/track";

const inputCls =
  "w-full px-4 py-3 bg-cyber-dark border border-neon-purple/40 rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple";
const btnCls =
  "px-6 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 via-neon-purple to-electric-blue text-white font-semibold text-sm shadow-lg shadow-neon-purple/40 hover:brightness-110 transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2";
const cardCls = "bg-cyber-card border border-cyber-border rounded-xl p-5";

function UpgradeCard({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="mt-6 bg-gradient-to-r from-neon-purple/10 to-electric-blue/10 border border-neon-purple/30 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <Sparkles className="w-6 h-6 text-neon-purple shrink-0" />
      <p className="flex-1 text-sm text-cyber-muted">{text}</p>
      <Link
        href={href}
        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-neon-purple to-electric-blue text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2 shrink-0"
      >
        {cta} <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function gradeColor(n: number): string {
  if (n >= 70) return "text-success";
  if (n >= 45) return "text-warning";
  return "text-red-400";
}

/* ---------- 1. Hook / Title Analyzer ---------- */
function HookTool() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    score: number;
    factors: { label: string; hit: boolean; tip: string }[];
    rewrites: string[];
  } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    track("tool_hook_run");
    const res = await fetch("/api/tools/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => null);
    if (res?.ok && d) setResult(d);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          className={inputCls}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder='e.g. "I quit my job to make faceless videos"'
          maxLength={300}
        />
        <button onClick={run} disabled={busy || !text.trim()} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Score my hook
        </button>
      </div>

      {result && (
        <div className="mt-8 space-y-5">
          <div className="flex items-center gap-6">
            <p className={`text-6xl font-bold tabular-nums ${gradeColor(result.score)}`}>
              {result.score}
            </p>
            <div className="flex-1 space-y-1.5">
              {result.factors.map((f) => (
                <div key={f.label} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      f.hit ? "bg-success/20 text-success" : "bg-cyber-border text-cyber-muted"
                    }`}
                  >
                    {f.hit ? "✓" : "·"}
                  </span>
                  <span className={f.hit ? "text-foreground" : "text-cyber-muted"}>
                    {f.label} <span className="text-cyber-muted">— {f.tip}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className={cardCls}>
            <p className="text-xs font-semibold text-foreground mb-3">
              Stronger patterns for the same idea:
            </p>
            <div className="space-y-2">
              {result.rewrites.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <p className="text-sm text-cyber-muted">{r}</p>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(r);
                      setCopied(i);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    className="shrink-0 text-xs text-neon-purple hover:underline flex items-center gap-1"
                  >
                    {copied === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === i ? "Copied" : "Copy"}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <UpgradeCard
            text="This scored one line. Virafold generates hooks that score 70+ from your actual content — and learns from the ones that win on your channel."
            href="/create/youtube-shorts"
            cta="Generate better hooks"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 2. Engagement-Rate Calculator ---------- */
function EngagementTool() {
  const [followers, setFollowers] = useState("");
  const [likes, setLikes] = useState("");
  const [comments, setComments] = useState("");

  const f = Number(followers) || 0;
  const rate = f > 0 ? ((Number(likes) || 0) + (Number(comments) || 0)) / f * 100 : null;

  const verdict = useMemo(() => {
    if (rate === null) return null;
    const bands =
      f < 10_000
        ? { low: 2, avg: 5, good: 10 }
        : f < 100_000
          ? { low: 1.5, avg: 3.5, good: 6 }
          : { low: 1, avg: 2.5, good: 5 };
    if (rate >= bands.good) return { label: "Excellent", color: "text-success" };
    if (rate >= bands.avg) return { label: "Good", color: "text-success" };
    if (rate >= bands.low) return { label: "Average", color: "text-warning" };
    return { label: "Below average", color: "text-red-400" };
  }, [rate, f]);

  return (
    <div>
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          ["Followers / subscribers", followers, setFollowers],
          ["Avg. likes per post", likes, setLikes],
          ["Avg. comments per post", comments, setComments],
        ].map(([label, val, set]) => (
          <div key={label as string}>
            <label className="block text-xs text-cyber-muted mb-1.5">{label as string}</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={val as string}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              placeholder="0"
            />
          </div>
        ))}
      </div>

      {rate !== null && verdict && (
        <div className="mt-8">
          <div className="flex items-center gap-6">
            <p className={`text-6xl font-bold tabular-nums ${verdict.color}`}>
              {rate.toFixed(1)}%
            </p>
            <div>
              <p className={`text-lg font-semibold ${verdict.color}`}>{verdict.label}</p>
              <p className="text-sm text-cyber-muted">
                for an account of your size — benchmarks tighten as audiences grow
              </p>
            </div>
          </div>
          <UpgradeCard
            text="That's one number. The free channel audit grades hooks, consistency, timing, format, and engagement — with your three best and worst videos — in 20 seconds."
            href="/audit"
            cta="Run the full audit"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 3. Hashtag Generator ---------- */
const PLATFORM_TAGS: Record<string, string[]> = {
  TikTok: ["fyp", "foryou", "learnontiktok", "tiktokmademebuyit"],
  Instagram: ["reels", "explore", "instagood", "reelsinstagram"],
  YouTube: ["shorts", "youtubeshorts", "subscribe", "viralshorts"],
  LinkedIn: ["career", "buildinpublic", "professionaldevelopment", "leadership"],
};

function HashtagTool() {
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("TikTok");
  const [tags, setTags] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    if (!topic.trim()) return;
    track("tool_hashtags_run");
    const words = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["the", "and", "for", "with", "your", "how"].includes(w));
    const joined = words.join("");
    const out = new Set<string>();
    if (joined && joined.length <= 28) out.add(joined);
    words.forEach((w) => out.add(w));
    for (let i = 0; i < words.length - 1; i++) out.add(words[i] + words[i + 1]);
    PLATFORM_TAGS[platform].forEach((t) => out.add(t));
    ["contentcreator", "creatortips"].forEach((t) => out.add(t));
    setTags([...out].slice(0, 16).map((t) => `#${t}`));
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          className={inputCls}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder='e.g. "morning routine for productivity"'
          maxLength={120}
        />
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="px-4 py-3 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
        >
          {Object.keys(PLATFORM_TAGS).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button onClick={generate} disabled={!topic.trim()} className={btnCls}>
          <Sparkles className="w-4 h-4" /> Generate
        </button>
      </div>

      {tags && (
        <div className="mt-8">
          <div className={cardCls}>
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.map((t) => (
                <span
                  key={t}
                  className="px-2.5 py-1 rounded-full bg-neon-purple/10 border border-neon-purple/30 text-neon-purple text-xs"
                >
                  {t}
                </span>
              ))}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(tags.join(" "));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="text-xs text-electric-blue hover:underline flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied all" : "Copy all"}
            </button>
          </div>
          <UpgradeCard
            text="Hashtags are the garnish. Virafold generates the whole post — script, caption, and tags — from one idea, in your brand voice."
            href="/create/tiktok"
            cta="Generate the full post"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 4. Channel Head-to-Head ---------- */
interface CmpSide {
  label: string;
  grade: number;
  posts: number;
  avgViews: number;
  engagementRate: number;
  sections: { key: string; score: number }[];
}

function CompareTool() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ a: CmpSide; b: CmpSide } | null>(null);

  const run = async () => {
    if (!a.trim() || !b.trim() || busy) return;
    setBusy(true);
    setErr(null);
    track("tool_compare_run");
    const res = await fetch("/api/tools/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: a.trim(), b: b.trim() }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => null);
    if (res?.ok && d?.a) setResult(d);
    else setErr(d?.error ?? "Could not run the comparison");
  };

  const Side = ({ s, win }: { s: CmpSide; win: boolean }) => (
    <div className={`${cardCls} ${win ? "border-success/40" : ""}`}>
      <p className="text-sm font-semibold text-foreground line-clamp-1 mb-1">{s.label}</p>
      <p className={`text-5xl font-bold tabular-nums ${gradeColor(s.grade)}`}>{s.grade}</p>
      <p className="text-[11px] text-cyber-muted mt-1">
        {s.posts} videos · {s.avgViews.toLocaleString()} avg views · {s.engagementRate}% eng.
      </p>
      <div className="mt-3 space-y-1">
        {s.sections.map((sec) => (
          <div key={sec.key} className="flex items-center gap-2">
            <span className="text-[10px] text-cyber-muted w-20 capitalize shrink-0">{sec.key}</span>
            <div className="flex-1 h-1.5 bg-cyber-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-purple to-electric-blue"
                style={{ width: `${sec.score}%` }}
              />
            </div>
            <span className="text-[10px] text-cyber-muted w-6 text-right tabular-nums">
              {sec.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3">
        <input className={inputCls} value={a} onChange={(e) => setA(e.target.value)} placeholder="@yourchannel" maxLength={200} />
        <span className="self-center text-cyber-muted text-sm font-bold shrink-0">vs</span>
        <input className={inputCls} value={b} onChange={(e) => setB(e.target.value)} placeholder="@competitor" maxLength={200} />
        <button onClick={run} disabled={busy || !a.trim() || !b.trim()} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
          Compare
        </button>
      </div>
      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

      {result && (
        <div className="mt-8">
          <div className="grid sm:grid-cols-2 gap-4">
            <Side s={result.a} win={result.a.grade >= result.b.grade} />
            <Side s={result.b} win={result.b.grade > result.a.grade} />
          </div>
          <UpgradeCard
            text="Add channels to your watchlist inside Virafold and they're re-audited weekly — their winning patterns quietly steer your own generations."
            href="/signup"
            cta="Track competitors"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 5. Best-Time-to-Post ---------- */
const SCHEDULES: Record<string, { primary: string; secondary: string; days: string }> = {
  TikTok: { primary: "19:00", secondary: "11:00", days: "Daily; extra slot Tue & Thu" },
  YouTube: { primary: "15:00", secondary: "10:00 weekend", days: "3–4× per week" },
  Instagram: { primary: "12:00", secondary: "19:30", days: "Daily reels; carousel Mon & Wed" },
  LinkedIn: { primary: "09:00", secondary: "07:30", days: "Tue–Thu are strongest" },
  X: { primary: "10:00", secondary: "17:00", days: "Daily; threads mid-week" },
};

function BestTimeTool() {
  const [platform, setPlatform] = useState("TikTok");
  const s = SCHEDULES[platform];

  const downloadPlan = () => {
    const rows = Object.entries(SCHEDULES).map(
      ([p, v]) => `${p},${v.primary},${v.secondary},"${v.days}"`
    );
    const csv = `platform,primary time,secondary time,cadence\n${rows.join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const el = document.createElement("a");
    el.href = url;
    el.download = "posting-schedule.csv";
    el.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 items-start">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="px-4 py-3 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
        >
          {Object.keys(SCHEDULES).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button onClick={downloadPlan} className={btnCls}>
          <Download className="w-4 h-4" /> Download full schedule (.csv)
        </button>
      </div>

      <div className={`${cardCls} mt-6`}>
        <div className="grid sm:grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-3xl font-bold text-neon-purple tabular-nums">{s.primary}</p>
            <p className="text-xs text-cyber-muted mt-1">Primary slot (local time)</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-electric-blue tabular-nums">{s.secondary}</p>
            <p className="text-xs text-cyber-muted mt-1">Secondary slot</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground mt-2">{s.days}</p>
            <p className="text-xs text-cyber-muted mt-1">Cadence</p>
          </div>
        </div>
        <p className="text-[11px] text-cyber-muted mt-4">
          These are audience-wide averages — honest, but generic. Your audience has its own rhythm.
        </p>
      </div>
      <UpgradeCard
        text="Virafold learns YOUR best hours from your actual post results and fills your week at those times automatically — one click."
        href="/signup"
        cta="Get personal timing"
      />
    </div>
  );
}

/* ---------- 6. Media-Kit Preview ---------- */
function MediaKitTool() {
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [followers, setFollowers] = useState("");
  const [rate, setRate] = useState("");

  const ready = name.trim() && niche.trim();

  return (
    <div>
      <div className="grid sm:grid-cols-2 gap-3">
        {[
          ["Creator / channel name", name, setName, "Ava Creates"],
          ["Niche", niche, setNiche, "Personal finance shorts"],
          ["Total followers", followers, setFollowers, "12,400"],
          ["Sponsored post rate ($)", rate, setRate, "350"],
        ].map(([label, val, set, ph]) => (
          <div key={label as string}>
            <label className="block text-xs text-cyber-muted mb-1.5">{label as string}</label>
            <input
              className={inputCls}
              value={val as string}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              placeholder={ph as string}
              maxLength={60}
            />
          </div>
        ))}
      </div>

      {ready && (
        <div className="mt-8">
          {/* The kit preview — screenshot-friendly */}
          <div className="rounded-2xl bg-gradient-to-r from-neon-purple via-fuchsia-500 to-electric-blue p-[1.5px] max-w-md mx-auto">
            <div className="bg-cyber-card rounded-2xl p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-neon-purple to-electric-blue mx-auto flex items-center justify-center text-white text-lg font-bold mb-3">
                {name.trim().charAt(0).toUpperCase()}
              </div>
              <p className="text-lg font-bold text-foreground">{name}</p>
              <p className="text-sm text-cyber-muted">{niche}</p>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <div className="bg-cyber-dark border border-cyber-border rounded-xl p-3">
                  <p className="text-xl font-bold text-foreground tabular-nums">
                    {followers || "—"}
                  </p>
                  <p className="text-[10px] text-cyber-muted mt-0.5">Followers</p>
                </div>
                <div className="bg-cyber-dark border border-cyber-border rounded-xl p-3">
                  <p className="text-xl font-bold text-foreground tabular-nums">
                    {rate ? `$${rate}` : "—"}
                  </p>
                  <p className="text-[10px] text-cyber-muted mt-0.5">Per sponsored post</p>
                </div>
              </div>
              <p className="text-[10px] text-cyber-muted mt-4">
                Made with Virafold · virafold.ai
              </p>
            </div>
          </div>
          <UpgradeCard
            text="Sign up free and this becomes a live hosted page at virafold.ai/kit/yourname — with real metrics pulled from your connected accounts and a brand-deal pipeline behind it."
            href="/signup"
            cta="Host my media kit"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 7. Auto-Subtitle Generator ---------- */
function CaptionTool() {
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState("bold");
  const [position, setPosition] = useState("bottom");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  const run = async () => {
    if (!file || busy) return;
    setBusy(true);
    setErr(null);
    setDoneId(null);
    track("tool_caption_run");
    const form = new FormData();
    form.append("file", file);
    form.append("style", style);
    form.append("position", position);
    const res = await fetch("/api/tools/caption", { method: "POST", body: form }).catch(
      () => null
    );
    setBusy(false);
    const d = await res?.json().catch(() => null);
    if (res?.ok && d?.id) setDoneId(d.id);
    else setErr(d?.error ?? "Could not caption that video");
  };

  return (
    <div>
      <div className="space-y-3">
        <label className="block">
          <span className="block text-xs text-cyber-muted mb-1.5">
            Video file (MP4/MOV, up to 25 MB / ~90 seconds)
          </span>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-cyber-muted file:mr-3 file:px-4 file:py-2.5 file:rounded-xl file:border-0 file:bg-cyber-dark file:text-foreground file:text-sm file:cursor-pointer"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="px-4 py-3 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            {["bold", "neon", "clean"].map((s) => (
              <option key={s} value={s}>
                Captions: {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="px-4 py-3 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground focus:outline-none focus:border-neon-purple/50"
          >
            {["bottom", "middle", "top"].map((p) => (
              <option key={p} value={p}>
                Position: {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <button onClick={run} disabled={busy || !file} className={btnCls}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy ? "Transcribing & burning…" : "Caption my video"}
          </button>
        </div>
        {busy && (
          <p className="text-xs text-cyber-muted">
            Usually 30–90 seconds — transcription plus a full re-render.
          </p>
        )}
        {err && <p className="text-sm text-red-400">{err}</p>}
      </div>

      {doneId && (
        <div className="mt-8">
          <div className={cardCls}>
            <video
              src={`/api/tools/caption/${doneId}`}
              controls
              className="w-full max-w-sm rounded-lg border border-cyber-border mx-auto"
            />
            <a
              href={`/api/tools/caption/${doneId}`}
              download="captioned.mp4"
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-electric-blue hover:underline"
            >
              <Download className="w-4 h-4" /> Download captioned video
            </a>
          </div>
          <UpgradeCard
            text="Free renders carry a small watermark and cap at 90 seconds. Signed in: full-length videos, no watermark, word-accurate timing, and clips cut from the same upload."
            href="/signup"
            cta="Caption full videos"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 8. Thumbnail Tester ---------- */
function ThumbTesterTool() {
  const [img, setImg] = useState<string | null>(null);

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImg(String(reader.result));
    reader.readAsDataURL(f);
  };

  const Fake = ({ title }: { title: string }) => (
    <div>
      <div className="aspect-video rounded-lg bg-cyber-dark border border-cyber-border" />
      <div className="mt-2 space-y-1">
        <div className="h-2 rounded-full bg-foreground/25 w-full" />
        <p className="text-[10px] text-cyber-muted">{title}</p>
      </div>
    </div>
  );

  return (
    <div>
      <label className="block">
        <span className="block text-xs text-cyber-muted mb-1.5">
          Your thumbnail (JPG/PNG — stays in your browser, never uploaded)
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-cyber-muted file:mr-3 file:px-4 file:py-2.5 file:rounded-xl file:border-0 file:bg-cyber-dark file:text-foreground file:text-sm file:cursor-pointer"
        />
      </label>

      {img && (
        <div className="mt-8 space-y-6">
          <div className={cardCls}>
            <p className="text-xs font-semibold text-foreground mb-3">
              In the feed, next to everyone else:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Fake title="Competitor video" />
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt="" className="aspect-video w-full object-cover rounded-lg border border-neon-purple/50" />
                <div className="mt-2 space-y-1">
                  <div className="h-2 rounded-full bg-foreground/40 w-full" />
                  <p className="text-[10px] text-neon-purple">Your video</p>
                </div>
              </div>
              <Fake title="Competitor video" />
            </div>
          </div>
          <div className={cardCls}>
            <p className="text-xs font-semibold text-foreground mb-3">
              At real sizes — most viewers see the smallest:
            </p>
            <div className="flex items-end gap-4 flex-wrap">
              {[240, 160, 100].map((w) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={w} src={img} alt="" style={{ width: w }} className="aspect-video object-cover rounded border border-cyber-border" />
              ))}
            </div>
            <p className="text-[11px] text-cyber-muted mt-3">
              Still readable at the smallest size? That's the one that decides your click-through.
            </p>
          </div>
          <UpgradeCard
            text="Need the thumbnail itself? Virafold generates AI thumbnail art with your title burned on, for every rendered clip."
            href="/signup"
            cta="Generate thumbnails"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 9. Video Ideas Generator ---------- */
function IdeasTool() {
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<{ title: string; score: number }[] | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const run = async () => {
    if (!niche.trim() || busy) return;
    setBusy(true);
    track("tool_ideas_run");
    const res = await fetch("/api/tools/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: niche.trim() }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => null);
    if (res?.ok && d?.ideas) setIdeas(d.ideas);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          className={inputCls}
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder='e.g. "personal finance" or "home coffee"'
          maxLength={80}
        />
        <button onClick={run} disabled={busy || !niche.trim()} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Get 10 ideas
        </button>
      </div>

      {ideas && (
        <div className="mt-8">
          <div className={cardCls}>
            <div className="space-y-2.5">
              {ideas.map((i, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span
                    className={`shrink-0 w-9 text-center text-xs font-bold tabular-nums px-1.5 py-1 rounded-lg border ${gradeColor(i.score)} border-current/40`}
                  >
                    {i.score}
                  </span>
                  <p className="flex-1 text-sm text-foreground">{i.title}</p>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(i.title);
                      setCopied(idx);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    className="shrink-0 text-xs text-neon-purple hover:underline flex items-center gap-1"
                  >
                    {copied === idx ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <UpgradeCard
            text="Any of these can become a full script and 30+ posts. Drop it in Virafold's Ideas tab — one click writes the script, another folds it into everything."
            href="/signup"
            cta="Turn ideas into content"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 10. Podcast Chapters & Show Notes ---------- */
function ChaptersTool() {
  const [transcript, setTranscript] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    chapters: { time: string; title: string }[];
    notes: string[];
    quotes: string[];
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (!transcript.trim() || busy) return;
    setBusy(true);
    setErr(null);
    track("tool_chapters_run");
    const res = await fetch("/api/tools/chapters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, durationMin: Number(durationMin) || 0 }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => null);
    if (res?.ok && d?.chapters) setResult(d);
    else setErr(d?.error ?? "Could not process that transcript");
  };

  const copyAll = () => {
    if (!result) return;
    const text = [
      "CHAPTERS",
      ...result.chapters.map((c) => `${c.time} ${c.title}`),
      "",
      "SHOW NOTES",
      ...result.notes.map((noteLine) => `- ${noteLine}`),
      "",
      "QUOTES",
      ...result.quotes,
    ].join("\n");
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <textarea
        className={`${inputCls} resize-y`}
        rows={6}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="Paste your episode transcript here (100+ words)…"
        maxLength={60000}
      />
      <div className="flex flex-wrap gap-3 mt-3">
        <input
          type="number"
          min={0}
          value={durationMin}
          onChange={(e) => setDurationMin(e.target.value)}
          placeholder="Episode length (min, optional)"
          className="px-4 py-3 bg-cyber-dark border border-cyber-border rounded-xl text-sm text-foreground placeholder:text-cyber-muted focus:outline-none focus:border-neon-purple/50 w-56"
        />
        <button onClick={run} disabled={busy || !transcript.trim()} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate chapters & notes
        </button>
      </div>
      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

      {result && (
        <div className="mt-8 space-y-4">
          <div className={cardCls}>
            <p className="text-xs font-semibold text-foreground mb-3">Chapters</p>
            <div className="space-y-1.5">
              {result.chapters.map((c) => (
                <p key={c.time} className="text-sm text-cyber-muted">
                  <span className="text-electric-blue tabular-nums">{c.time}</span>{" "}
                  <span className="text-foreground">{c.title}</span>
                </p>
              ))}
            </div>
          </div>
          <div className={cardCls}>
            <p className="text-xs font-semibold text-foreground mb-3">Show notes</p>
            <ul className="space-y-1.5 list-disc pl-4">
              {result.notes.map((noteLine, i) => (
                <li key={i} className="text-sm text-cyber-muted">
                  {noteLine}
                </li>
              ))}
            </ul>
            {result.quotes.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {result.quotes.map((q, i) => (
                  <p key={i} className="text-sm text-neon-purple italic">
                    {q}
                  </p>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={copyAll}
            className="text-xs text-electric-blue hover:underline flex items-center gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied everything" : "Copy everything"}
          </button>
          <UpgradeCard
            text="This episode is also 30+ posts. Upload it to Virafold and the same transcript becomes clips, threads, a newsletter, and carousels — automatically."
            href="/for/podcasters"
            cta="See Virafold for podcasters"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- 11. Website Content Score ---------- */
interface WsSection {
  key: string;
  label: string;
  score: number;
  notes: string[];
}
interface WsReport {
  url: string;
  fetchedPages: number;
  hasSitemap: boolean;
  hasLlmsTxt: boolean;
  hasRss: boolean;
  sections: WsSection[];
  total: number;
  grade: string;
  trappedPosts: number;
  trappedAssets: number;
}

function WebsiteScoreTool() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WsReport | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditMsg, setAuditMsg] = useState<string | null>(null);

  async function run() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setReport(null);
    setAuditMsg(null);
    try {
      const res = await fetch("/api/tools/website-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(String(data?.error ?? "Something went wrong — try again"));
      else {
        setReport(data.report);
        track("tool_website_score");
      }
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setLoading(false);
    }
  }

  async function startAudit() {
    if (!report || auditBusy) return;
    setAuditBusy(true);
    setAuditMsg(null);
    try {
      const res = await fetch("/api/site-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: report.url }),
      });
      if (res.status === 401) {
        window.location.href = "/signup";
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      if (data?.operator && data?.id) {
        window.location.href = `/site-audit/${data.id}`;
        return;
      }
      if (data?.demo) {
        setAuditMsg(
          "Payments aren't live quite yet. Create a free account and you'll be first to know when the Complete Audit opens — the free score above is yours to keep either way."
        );
        return;
      }
      setAuditMsg(String(data?.error ?? "Could not start the audit — try again shortly"));
    } catch {
      setAuditMsg("Could not start the audit — try again shortly");
    } finally {
      setAuditBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <label className="block text-sm text-cyber-muted mb-2">Your website</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className={inputCls}
            placeholder="yourdomain.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
          <button className={btnCls} onClick={run} disabled={loading || !url.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "Reading your site…" : "Score my site"}
          </button>
        </div>
        <p className="mt-2 text-xs text-cyber-muted">
          We fetch up to 8 public pages (sitemap first) and grade them with named, deterministic
          checks — no AI guesswork in the score. Takes ~15 seconds.
        </p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {report && (
        <>
          <div className={cardCls}>
            <div className="flex flex-wrap items-center gap-5">
              <div className="text-center">
                <p className={`text-5xl font-bold ${gradeColor(report.total)}`}>{report.grade}</p>
                <p className="text-sm text-cyber-muted mt-1">{report.total}/100</p>
              </div>
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm text-foreground font-medium break-all">{report.url}</p>
                <p className="text-xs text-cyber-muted mt-1">
                  {report.fetchedPages} pages scanned · sitemap {report.hasSitemap ? "✓" : "✗"} · RSS{" "}
                  {report.hasRss ? "✓" : "✗"} · llms.txt {report.hasLlmsTxt ? "✓" : "✗"}
                </p>
                {report.trappedPosts > 0 && (
                  <p className="mt-2 text-sm text-neon-purple">
                    ≈{report.trappedAssets} social assets are trapped in {report.trappedPosts}{" "}
                    substantial pages — threads, carousels, newsletters, and short scripts nobody
                    has seen yet.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {report.sections.map((s) => (
              <div key={s.key} className={cardCls}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">{s.label}</p>
                  <p className={`text-sm font-bold ${gradeColor(s.score * 5)}`}>{s.score}/20</p>
                </div>
                <div className="h-1.5 rounded-full bg-cyber-border mb-3">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-purple to-electric-blue"
                    style={{ width: `${(s.score / 20) * 100}%` }}
                  />
                </div>
                <ul className="space-y-1.5">
                  {s.notes.map((n, i) => (
                    <li key={i} className="text-xs text-cyber-muted leading-relaxed">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="bg-gradient-to-r from-neon-purple/10 to-electric-blue/10 border border-neon-purple/30 rounded-xl p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Sparkles className="w-6 h-6 text-neon-purple shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Complete Content Audit — $49
                </p>
                <p className="text-sm text-cyber-muted mt-1">
                  This free score reads 8 pages. The complete audit crawls your whole site (up to
                  120 pages), adds AI page-by-page verdicts and headline rewrites, maps your
                  content gaps, and delivers a prioritized 30-day repurposing plan to your inbox.
                  Fully automated — and the $49 is credited toward your first month if you
                  subscribe within 30 days.
                </p>
              </div>
              <button onClick={startAudit} disabled={auditBusy} className={btnCls}>
                {auditBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Get the full audit
              </button>
            </div>
            {auditMsg && <p className="mt-3 text-sm text-warning">{auditMsg}</p>}
          </div>

          <UpgradeCard
            text="Prefer to just start shipping? Paste any post's URL into Virafold and it becomes a thread, carousel, and newsletter in one run — free plan included."
            href="/signup"
            cta="Start free"
          />
        </>
      )}
    </div>
  );
}

export default function FreeToolClient({ tool }: { tool: string }) {
  switch (tool) {
    case "hook-analyzer":
      return <HookTool />;
    case "engagement-calculator":
      return <EngagementTool />;
    case "hashtag-generator":
      return <HashtagTool />;
    case "channel-compare":
      return <CompareTool />;
    case "best-time-to-post":
      return <BestTimeTool />;
    case "media-kit":
      return <MediaKitTool />;
    case "caption-generator":
      return <CaptionTool />;
    case "thumbnail-tester":
      return <ThumbTesterTool />;
    case "video-ideas":
      return <IdeasTool />;
    case "podcast-chapters":
      return <ChaptersTool />;
    case "website-score":
      return <WebsiteScoreTool />;
    default:
      return null;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getRealSessionUser } from "@/lib/server/auth";
import { getSiteAudit } from "@/lib/server/db";
import { getOrTranslate, isTranslatableLocale } from "@/lib/server/translate";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Translate a purchased audit report (owner-only): sections + coach text,
 *  cached per language — real added value for non-English buyers. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = rateLimit(`xlate-audit:${user.email}`, 10, 60 * 60 * 1000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const audit = getSiteAudit(user.email, id);
  if (!audit || !audit.report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const locale = String((body as Record<string, unknown>)?.locale ?? "");
  if (!isTranslatableLocale(locale)) {
    return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  }

  const full = JSON.parse(audit.report);
  const source = {
    sections: (full.report?.sections ?? []).map((s: { label: string; notes: string[] }) => ({
      label: s.label,
      notes: s.notes,
    })),
    coach: full.coach
      ? {
          summary: full.coach.summary,
          pageAdvice: (full.coach.pageAdvice ?? []).map(
            (a: { verdict: string; headlineRewrite: string }) => ({
              verdict: a.verdict,
              headlineRewrite: a.headlineRewrite,
            })
          ),
          contentGaps: full.coach.contentGaps ?? [],
          plan: full.coach.plan ?? [],
        }
      : null,
  };

  const result = await getOrTranslate(`audit:${id}`, locale, source);
  if (!result) {
    return NextResponse.json(
      { error: "Translation is unavailable right now — try again shortly" },
      { status: 503 }
    );
  }
  return NextResponse.json({ translation: result.payload, cached: result.cached });
}

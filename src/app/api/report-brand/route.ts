import { NextRequest, NextResponse } from "next/server";
import { getRealSessionUser } from "@/lib/server/auth";
import { bestPlanFor, getReportBrand, getUserCredits, insertAudit, setReportBrand } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** White-label reports: an agency name shown on purchased audit reports in
 *  place of the Virafold sales framing. Text only, honest scope — the report
 *  content itself is unchanged. Available to paid plans and audit-pack buyers. */

function eligible(email: string): boolean {
  return bestPlanFor(email) !== "Free" || getUserCredits(email).auditCredits > 0;
}

export async function GET() {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ brand: getReportBrand(user.email), eligible: eligible(user.email) });
}

export async function POST(req: NextRequest) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!eligible(user.email)) {
    return NextResponse.json(
      { error: "White-label reports are included with paid plans and audit packs." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  // Empty string turns white-labeling off. Strip angle brackets — the value
  // renders in JSX (safe) but has no business containing markup.
  const brand = String((body as Record<string, unknown>)?.brand ?? "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 60);
  setReportBrand(user.email, brand);
  insertAudit(user.email, "report_brand.set", brand || "(cleared)");
  return NextResponse.json({ brand });
}

import { NextRequest, NextResponse } from "next/server";
import { getRealSessionUser } from "@/lib/server/auth";
import { getSiteAudit } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** One audit, owner-only — powers the report page (poll-friendly). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getRealSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const audit = getSiteAudit(user.email, id);
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    id: audit.id,
    url: audit.url,
    status: audit.status,
    paid: audit.paid,
    score: audit.score,
    report: audit.report ? JSON.parse(audit.report) : null,
    error: audit.error,
    createdAt: audit.createdAt,
    completedAt: audit.completedAt,
  });
}

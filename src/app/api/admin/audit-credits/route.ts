import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/server/auth";
import {
  addAuditCredits,
  addBonusProjects,
  findUser,
  getUserCredits,
  insertAudit,
  insertNotification,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Operator grant of one-off credits (make-goods, manual sales, testing).
 *  body: { email, auditCredits?, bonusProjects? } — either count 1–50. */
export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const email = String(b?.email ?? "").trim().toLowerCase();
  const auditCredits = Math.round(Number(b?.auditCredits ?? 0));
  const bonusProjects = Math.round(Number(b?.bonusProjects ?? 0));
  const valid = (n: number) => Number.isFinite(n) && n >= 0 && n <= 50;
  if (!email || !valid(auditCredits) || !valid(bonusProjects) || auditCredits + bonusProjects === 0) {
    return NextResponse.json(
      { error: "email plus auditCredits and/or bonusProjects (1–50) are required" },
      { status: 400 }
    );
  }
  if (!findUser(email)) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (auditCredits > 0) addAuditCredits(email, auditCredits);
  if (bonusProjects > 0) addBonusProjects(email, bonusProjects);
  insertAudit(admin.email, "credits.grant", `${email}: +${auditCredits} audits, +${bonusProjects} projects`);
  insertNotification(email, {
    id: `n-${crypto.randomUUID()}`,
    title: "Credits added",
    message: [
      auditCredits > 0 ? `${auditCredits} audit credit${auditCredits === 1 ? "" : "s"}` : "",
      bonusProjects > 0 ? `${bonusProjects} bonus project${bonusProjects === 1 ? "" : "s"}` : "",
    ]
      .filter(Boolean)
      .join(" and ")
      .concat(" added to your account."),
    time: "Just now",
    read: false,
    type: "success",
  });
  return NextResponse.json({ email, ...getUserCredits(email) });
}

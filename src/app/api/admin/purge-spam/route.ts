import { NextRequest, NextResponse } from "next/server";
import { getAdminUser, isAdminEmail } from "@/lib/server/auth";
import { deleteAccount, insertAudit, listSpamAccounts } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/**
 * Signup-spam cleanup: bots register victims' addresses with a spam link in
 * the NAME field, riding our verification email as a relay. Detection is the
 * link-in-name signature; GET previews the matches, POST {confirm:true}
 * deletes them through the same full-cascade deleteAccount the Danger Zone
 * uses. Admin accounts can never match-delete themselves.
 */

export async function GET(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const contains = req.nextUrl.searchParams.get("contains") ?? undefined;
  const matches = listSpamAccounts(contains).filter((u) => !isAdminEmail(u.email));
  return NextResponse.json({
    count: matches.length,
    sample: matches.slice(0, 5).map((m) => ({ email: m.email, name: m.name.slice(0, 80) })),
  });
}

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
  if (b?.confirm !== true) {
    return NextResponse.json({ error: "Pass confirm: true to delete" }, { status: 400 });
  }
  const contains = b?.contains ? String(b.contains) : undefined;

  const matches = listSpamAccounts(contains).filter((u) => !isAdminEmail(u.email));
  let deleted = 0;
  const errors: string[] = [];
  // Bounded per call; run again if more remain.
  for (const u of matches.slice(0, 500)) {
    try {
      deleteAccount(u.email);
      deleted++;
    } catch (e) {
      errors.push(`${u.email}: ${String(e instanceof Error ? e.message : e).slice(0, 80)}`);
    }
  }
  insertAudit(admin.email, "spam.purge", `deleted ${deleted}/${matches.length}${contains ? ` (contains: ${contains})` : ""}`);
  return NextResponse.json({ deleted, remaining: matches.length - deleted, errors: errors.slice(0, 5) });
}

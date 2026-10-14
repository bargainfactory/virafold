import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/server/auth";
import {
  deleteGenImage,
  getGenImageFull,
  insertPersona,
  listPersonas,
  setPersonaMeta,
} from "@/lib/server/db";
import type { PropType } from "@/lib/server/db";
import { describeImage } from "@/lib/server/images";
import { PTYPES, VISION } from "@/lib/server/prop-prompts";

export const dynamic = "force-dynamic";

/**
 * Character Builder, step 2: Accept a candidate. The chosen image becomes a
 * named prop in the library (vision description follows in the background)
 * and the candidate row is removed — unaccepted candidates simply age out
 * with the normal image retention.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const imageId = String(b?.imageId ?? "");
  const name = String(b?.name ?? "").trim().slice(0, 60);
  const ptypeRaw = String(b?.ptype ?? "character") as PropType;
  const ptype = PTYPES.has(ptypeRaw) ? ptypeRaw : "character";
  if (!imageId || name.length < 1) {
    return NextResponse.json({ error: "Name the character before accepting" }, { status: 400 });
  }
  if (listPersonas(user.email).length >= 24) {
    return NextResponse.json({ error: "Prop limit reached (24) — delete one first." }, { status: 422 });
  }
  const img = getGenImageFull(user.email, imageId);
  if (!img) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(process.cwd(), img.path));
  } catch {
    return NextResponse.json({ error: "Candidate image missing" }, { status: 404 });
  }

  const persona = insertPersona(user.email, {
    id: `per-${crypto.randomUUID()}`,
    name,
    source: "generated",
    ptype,
    meta: img.prompt.slice(0, 300),
    image: bytes,
  });
  deleteGenImage(user.email, imageId);
  describeImage(bytes, VISION[ptype])
    .then((meta) => meta && setPersonaMeta(user.email, persona.id, meta))
    .catch(() => {});
  return NextResponse.json({ persona }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { deleteIdea, getIdea, updateIdea } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["idea", "scripted", "generated"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!getIdea(user.email, id)) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const updates: Parameters<typeof updateIdea>[2] = {};
  if (typeof b.title === "string" && b.title.trim())
    updates.title = b.title.trim().slice(0, 200);
  if (typeof b.notes === "string") updates.notes = b.notes.slice(0, 2000);
  if (typeof b.script === "string") updates.script = b.script.slice(0, 60000);
  if (typeof b.status === "string" && STATUSES.has(b.status))
    updates.status = b.status as "idea" | "scripted" | "generated";
  if (typeof b.videoMade === "boolean") updates.videoMade = b.videoMade;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  return NextResponse.json({ idea: updateIdea(user.email, id, updates) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  deleteIdea(user.email, id);
  return NextResponse.json({ ok: true });
}

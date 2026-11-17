// Your profile: the name, initials and title threads and sign-offs show.
// Saved as the signed-in person only.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { saveProfile } from "@/modules/finance/lib/threads";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const r = await saveProfile(actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

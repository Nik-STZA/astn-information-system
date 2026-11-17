// Threads: a new entry or reply, as the signed-in person. finance-api checks
// their role on the client, the entry and that a reply stays in its thread.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { postThreadEntry } from "@/modules/finance/lib/asset-schedule";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const r = await postThreadEntry(slug, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

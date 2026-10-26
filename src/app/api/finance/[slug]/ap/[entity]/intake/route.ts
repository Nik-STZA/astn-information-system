// Reads new Documents-inbox files into the AP queue. Nothing is written to Xero.
import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { runIntake } from "@/modules/finance/lib/ap-queue";

export const dynamic = "force-dynamic";
// Three model reads a call, each up to about 30 seconds.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: { slug: string; entity: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const r = await runIntake(params.slug, params.entity, actorEmail, 3);
  return r.ok
    ? NextResponse.json(r.data)
    : NextResponse.json({ error: r.error }, { status: r.status });
}

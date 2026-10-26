// The CFO's decision on an exception: approve (with any edits) or reject.
// Nothing goes to Xero here.
import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { decideApItem, type ApDecisionBody } from "@/modules/finance/lib/ap-queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { slug: string; entity: string; id: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as ApDecisionBody;
  const r = await decideApItem(params.slug, params.entity, params.id, actorEmail, body);
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

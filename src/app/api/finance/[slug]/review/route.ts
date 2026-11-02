// Review: the sidebar's count, read from finance-api as the signed-in person so
// it counts what waits on their own role. Read-only, and GET only: there is no
// way to act on an item through here. The proxy's origin check covers anything
// that is not a read.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { fetchReviewCount } from "@/modules/finance/lib/review";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const r = await fetchReviewCount(slug, actorEmail);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ total: r.data.total, for_you: r.data.for_you }, { headers: { "Cache-Control": "no-store" } });
}

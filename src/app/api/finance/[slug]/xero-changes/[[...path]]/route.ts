// Xero changes: passes the CFO's approve and reject through to finance-api as
// the signed-in person. Only the paths in isChangePath are reachable; anything
// else 404s. No agent header is ever sent from here, so finance-api treats
// every call as a person's and checks the CFO role there.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isChangePath } from "@/modules/finance/lib/xero-changes";
import { workCall } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path?: string[] }> };

export async function POST(req: Request, ctx: Ctx) {
  const params = await ctx.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const path = ["xero-changes", ...(params.path ?? []).map(encodeURIComponent)].join("/");
  if (!isChangePath(path)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await workCall(params.slug, path, "POST", actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

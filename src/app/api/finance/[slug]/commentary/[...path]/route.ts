// Pack commentary: passes the portal's saves and the CFO's approval through to
// finance-api as the signed-in person. Only the paths in isCommentaryPath are
// reachable. No agent header is ever sent from here, so finance-api treats
// every call as a person's and checks the CFO's role there.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isCommentaryPath } from "@/modules/finance/lib/commentary";
import { workCall } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

export async function POST(req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const { slug, path } = await ctx.params;
  const target = `commentary/${path.map(encodeURIComponent).join("/")}`;
  if (!isCommentaryPath(target)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await workCall(slug, target, "POST", actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

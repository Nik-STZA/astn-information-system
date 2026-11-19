// Accruals: passes the portal's calls through to finance-api as the signed-in
// person. Only the paths in isAccrualPath are reachable; anything else 404s. No
// agent header is ever sent from here, so finance-api treats every call as a
// person's, and the CFO's decisions are checked there against their role.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isAccrualPath } from "@/modules/finance/lib/accruals";
import { workCall } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

async function pass(method: "POST" | "PUT", req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const { slug, path } = await ctx.params;
  const target = `accruals/${path.map(encodeURIComponent).join("/")}`;
  if (!isAccrualPath(target, method)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await workCall(slug, target, method, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

export const POST = (req: Request, ctx: Ctx) => pass("POST", req, ctx);
export const PUT = (req: Request, ctx: Ctx) => pass("PUT", req, ctx);

// Payroll: passes the portal's uploads, roles, shares and requests through to
// finance-api as the signed-in person. Only the paths in isPayrollPath are
// reachable. No agent header is ever sent from here; finance-api checks the
// CFO's role where it matters, and refuses any column that is not a code or a
// payroll figure.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isPayrollPath } from "@/modules/finance/lib/payroll";
import { workCall } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

async function pass(method: "POST" | "PUT", req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const { slug, path } = await ctx.params;
  const target = `payroll/${path.map(encodeURIComponent).join("/")}`;
  if (!isPayrollPath(target)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await workCall(slug, target, method, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

export const POST = (req: Request, ctx: Ctx) => pass("POST", req, ctx);
export const PUT = (req: Request, ctx: Ctx) => pass("PUT", req, ctx);

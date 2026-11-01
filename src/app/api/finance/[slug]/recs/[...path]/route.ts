// Reconciliations: passes the portal's calls through to finance-api as the
// signed-in person. Only the paths in isRecPath are reachable; anything else
// 404s, and an agent's routes are not among them.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isRecPath } from "@/modules/finance/lib/recs";
import { workCall } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

async function pass(req: Request, ctx: Ctx, method: string) {
  const params = await ctx.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const path = `recs/${params.path.map(encodeURIComponent).join("/")}`;
  if (!isRecPath(path)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = method === "DELETE" ? undefined : await req.json().catch(() => ({}));
  const r = await workCall(params.slug, path, method, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

export const POST = (req: Request, ctx: Ctx) => pass(req, ctx, "POST");
export const PATCH = (req: Request, ctx: Ctx) => pass(req, ctx, "PATCH");
export const PUT = (req: Request, ctx: Ctx) => pass(req, ctx, "PUT");
export const DELETE = (req: Request, ctx: Ctx) => pass(req, ctx, "DELETE");

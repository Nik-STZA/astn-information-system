// Work: passes the portal's task calls through to finance-api as the signed-in
// person. Only the task paths in isWorkPath are reachable; anything else 404s.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isWorkPath, workCall } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

type Ctx = { params: { slug: string; path: string[] } };

async function pass(req: Request, { params }: Ctx, method: string) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const path = params.path.map(encodeURIComponent).join("/");
  if (!isWorkPath(path)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = method === "GET" || method === "DELETE" ? undefined : await req.json().catch(() => ({}));
  const r = await workCall(params.slug, path, method, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

export const GET = (req: Request, ctx: Ctx) => pass(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => pass(req, ctx, "POST");
export const PATCH = (req: Request, ctx: Ctx) => pass(req, ctx, "PATCH");
export const DELETE = (req: Request, ctx: Ctx) => pass(req, ctx, "DELETE");

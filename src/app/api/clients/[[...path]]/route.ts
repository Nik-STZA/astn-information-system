// Client master: passes the portal's changes through to finance-api as the
// signed-in person. Only the master's own paths (isMasterPath) are reachable.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isMasterPath, masterCall } from "@/modules/finance/lib/clients";

export const dynamic = "force-dynamic";

type Ctx = { params: { path?: string[] } };

async function pass(req: Request, { params }: Ctx, method: string) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const path = (params.path ?? []).map(encodeURIComponent).join("/");
  if (!isMasterPath(path)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await masterCall(path, method, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

export const POST = (req: Request, ctx: Ctx) => pass(req, ctx, "POST");
export const PATCH = (req: Request, ctx: Ctx) => pass(req, ctx, "PATCH");
export const PUT = (req: Request, ctx: Ctx) => pass(req, ctx, "PUT");

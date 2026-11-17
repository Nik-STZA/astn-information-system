// Asset register: passes the portal's decisions through to finance-api as the
// signed-in person. Only the paths in isAssetRegisterPath are reachable
// (deciding lines, signing and reopening months). finance-api checks that the
// person is the client's CFO, the reason, and the period lock.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { assetRegisterCall, isAssetRegisterPath } from "@/modules/finance/lib/asset-register";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

export async function POST(req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const { slug, path } = await ctx.params;
  const target = `asset-register/${path.map(encodeURIComponent).join("/")}`;
  if (!isAssetRegisterPath(target)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await assetRegisterCall(slug, target, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

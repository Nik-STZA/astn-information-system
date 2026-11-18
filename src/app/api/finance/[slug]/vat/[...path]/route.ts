// VAT returns: passes the portal's uploads and decisions through to
// finance-api as the signed-in person. Only the paths in isVatPath are
// reachable (opening a return, uploading an export, accepting an adjustment,
// recording an import file). finance-api checks the role and the period.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isVatPath, vatCall } from "@/modules/finance/lib/vat";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

export async function POST(req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const { slug, path } = await ctx.params;
  const target = `vat/${path.map(encodeURIComponent).join("/")}`;
  if (!isVatPath(target)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await vatCall(slug, target, actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

// Journals: passes the portal's calls through to finance-api as the signed-in
// person. Only the paths in isJournalPath are reachable; anything else 404s.
// No agent header is ever sent from here, so finance-api treats every call as a
// person's, and the CFO's decision is checked there against their role.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { isJournalPath } from "@/modules/finance/lib/journals";
import { workCall } from "@/modules/finance/lib/work";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path?: string[] }> };

export async function POST(req: Request, ctx: Ctx) {
  const params = await ctx.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const rest = (params.path ?? []).map(encodeURIComponent).join("/");
  const path = rest ? `journals/${rest}` : "journals";
  if (!isJournalPath(path)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await workCall(params.slug, path, "POST", actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

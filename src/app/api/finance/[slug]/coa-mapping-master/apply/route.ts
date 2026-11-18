import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { applyMaster, type MasterBody } from "@/modules/finance/lib/coa";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

// Saves a master mapping file for every company (finance-api plans it again
// and refuses approval by anyone but the CFO).
export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as MasterBody;
  const r = await applyMaster({ slug: params.slug, actorEmail, ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined, body });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error, errors: r.errors }, { status: r.status });
}

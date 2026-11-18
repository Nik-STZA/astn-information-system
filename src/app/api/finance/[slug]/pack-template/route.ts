import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { savePackTemplate } from "@/modules/finance/lib/coa";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

// The CFO picks the client's management pack template (finance-api refuses anyone else).
export async function PUT(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { template?: string };
  const r = await savePackTemplate({
    slug: params.slug,
    template: String(body.template ?? ""),
    actorEmail,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
  });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { mapXeroOrganisation } from "@/modules/finance/lib/secrets";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string; entity: string } }
) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const tenantId = (body as { tenantId?: string }).tenantId;
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  const result = await mapXeroOrganisation({
    slug: params.slug,
    entity: params.entity,
    tenantId,
    actorEmail,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
  });

  return result.ok
    ? NextResponse.json({ ok: true, tenantName: result.tenantName })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

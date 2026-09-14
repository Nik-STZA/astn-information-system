import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { saveMappings, type MappingChange } from "@/modules/finance/lib/coa";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { slug: string; entity: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    changes?: MappingChange[];
    source?: "manual" | "upload" | "rule";
    note?: string;
  };
  if (!Array.isArray(body.changes) || !body.changes.length) {
    return NextResponse.json({ error: "changes are required" }, { status: 400 });
  }
  const r = await saveMappings({
    slug: params.slug,
    entity: params.entity,
    actorEmail,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
    changes: body.changes,
    source: body.source,
    note: body.note,
  });
  return r.ok
    ? NextResponse.json(r.data)
    : NextResponse.json({ error: r.error, errors: r.errors }, { status: r.status });
}

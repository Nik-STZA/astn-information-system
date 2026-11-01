import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { removeCategory, saveCategory } from "@/modules/finance/lib/coa";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; key: string }> };

export async function PUT(req: NextRequest, props: Params) {
  const params = await props.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const r = await saveCategory({
    slug: params.slug,
    key: params.key,
    actorEmail,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
    body,
  });
  return r.ok
    ? NextResponse.json(r.data)
    : NextResponse.json({ error: r.error, errors: r.errors }, { status: r.status });
}

export async function DELETE(req: NextRequest, props: Params) {
  const params = await props.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const r = await removeCategory({
    slug: params.slug,
    key: params.key,
    actorEmail,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
  });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

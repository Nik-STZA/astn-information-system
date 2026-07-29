// Thin shell route. Its only job is to establish who is asking, from the IAP
// assertion, and hand that to the module. The module owns the behaviour; the
// shell owns identity.

import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { accessXeroSecret } from "@/modules/finance/lib/secrets";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string; entity: string } }
) {
  const actorEmail = getIapEmail();
  if (!actorEmail) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, field } = body as { action?: string; field?: string };

  if (action !== "reveal" && action !== "copy") {
    return NextResponse.json({ error: "action must be reveal or copy" }, { status: 400 });
  }
  if (field !== "client_id" && field !== "client_secret" && field !== "refresh_token") {
    return NextResponse.json({ error: "unknown field" }, { status: 400 });
  }

  const result = await accessXeroSecret({
    slug: params.slug,
    entity: params.entity,
    field,
    action,
    actorEmail,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Cache headers are explicit: a secret must never be stored by any hop.
  return NextResponse.json(
    { value: result.value },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" } }
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { previewMaster, type MasterBody } from "@/modules/finance/lib/coa";

export const dynamic = "force-dynamic";

// What a master mapping file would change, for every company. Saves nothing.
export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as MasterBody;
  const r = await previewMaster({ slug: params.slug, actorEmail, body });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

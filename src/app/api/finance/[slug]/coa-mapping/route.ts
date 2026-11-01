import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { fetchCoaMapping } from "@/modules/finance/lib/coa";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  if (!await getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const r = await fetchCoaMapping(params.slug, req.nextUrl.searchParams.get("entity") ?? undefined);
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

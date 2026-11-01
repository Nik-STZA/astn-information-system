import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { fetchReportingCategories } from "@/modules/finance/lib/coa";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  if (!await getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const r = await fetchReportingCategories(params.slug);
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

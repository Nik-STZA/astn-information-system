import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { fetchXeroOrganisations } from "@/modules/finance/lib/secrets";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  if (!getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });

  const result = await fetchXeroOrganisations(params.slug);
  return result.ok
    ? NextResponse.json({ data: result.data })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

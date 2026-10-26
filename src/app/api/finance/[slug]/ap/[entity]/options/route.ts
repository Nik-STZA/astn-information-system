// Accounts, VAT treatments and suppliers for deciding an exception.
import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { fetchApOptions } from "@/modules/finance/lib/ap-queue";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string; entity: string } }) {
  if (!getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const r = await fetchApOptions(params.slug, params.entity);
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}

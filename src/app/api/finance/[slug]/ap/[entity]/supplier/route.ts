// A new supplier in Xero, created by the CFO from an AP Clerk recommendation.
import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { createApSupplier } from "@/modules/finance/lib/ap-queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { slug: string; entity: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; vat_number?: string | null; country?: string | null; item_id?: string };
  if (!b.name || !b.item_id) return NextResponse.json({ error: "name and item_id are required" }, { status: 400 });
  const r = await createApSupplier(params.slug, params.entity, actorEmail, { name: b.name, vat_number: b.vat_number, country: b.country, item_id: b.item_id });
  return NextResponse.json(r.data, { status: r.status });
}

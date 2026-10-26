// Sends a clean or approved item to Xero as a bill at Awaiting approval, with
// its document attached. A dry run unless { dry_run: false }.
import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { sendApItem } from "@/modules/finance/lib/ap-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: { slug: string; entity: string; id: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
  const r = await sendApItem(params.slug, params.entity, params.id, actorEmail, body.dry_run !== false);
  return NextResponse.json(r.data, { status: r.status });
}

// The document behind a queue item, for the viewer beside the proposed bill.
import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { fetchApFile } from "@/modules/finance/lib/ap-queue";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string; entity: string; id: string } }) {
  if (!getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const upstream = await fetchApFile(params.slug, params.entity, params.id);
  if (!upstream.ok) return NextResponse.json({ error: `the document could not be fetched (${upstream.status})` }, { status: upstream.status });
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": upstream.headers.get("content-disposition") ?? "inline",
      // Client documents: never kept by a shared cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

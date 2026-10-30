// The document behind a queue item, for the viewer beside the proposed bill.
import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { fetchApFile } from "@/modules/finance/lib/ap-queue";

export const dynamic = "force-dynamic";

// Bills arrive from outside. Only these open in the browser; anything else
// downloads, so a file pretending to be a web page cannot run as one of ours.
const SHOWN = /^(application\/pdf|image\/(png|jpeg|webp|heic|heif))\b/i;

export async function GET(_req: Request, { params }: { params: { slug: string; entity: string; id: string } }) {
  if (!getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const upstream = await fetchApFile(params.slug, params.entity, params.id);
  if (!upstream.ok) return NextResponse.json({ error: `the document could not be fetched (${upstream.status})` }, { status: upstream.status });
  const type = upstream.headers.get("content-type") ?? "";
  const shown = SHOWN.test(type);
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": shown ? type : "application/octet-stream",
      "Content-Disposition": shown ? upstream.headers.get("content-disposition") ?? "inline" : "attachment",
      // Client documents: never kept by a shared cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

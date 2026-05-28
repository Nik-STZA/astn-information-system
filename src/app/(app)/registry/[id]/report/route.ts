import { NextResponse } from "next/server";
import { fetchOrganization } from "@/lib/data/registry";
import { buildOrganizationProfileDocx, profileFilename } from "@/lib/reports/orgProfile";

export const dynamic = "force-dynamic";
// docx needs fs access for the protea logo, and the Buffer payload is small,
// so run on the Node runtime rather than edge.
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const org = await fetchOrganization(params.id);
  if (!org) {
    return new NextResponse("Organisation not found", { status: 404 });
  }

  const buffer = await buildOrganizationProfileDocx(org);
  const filename = profileFilename(org);

  // Wrap in a Blob so NextResponse accepts it as BodyInit - the TS lib def
  // for Response rejects Buffer / Uint8Array<ArrayBufferLike> directly.
  const body = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// Outstanding documents: passes the portal's calls through to finance-api as
// the signed-in person. Only the paths in isDocsPath are reachable. No agent
// header is ever sent from here, so finance-api treats every call as a
// person's and checks their role there.
//
// An upload is the file itself as the request body, its name in X-File-Name.

import { NextResponse } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { docsCall, fetchUploadFile, isDocsPath, MAX_FILE_BYTES } from "@/modules/finance/lib/outstanding-docs";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path?: string[] }> };

async function target(ctx: Ctx) {
  const params = await ctx.params;
  const rest = (params.path ?? []).map(encodeURIComponent).join("/");
  const path = rest ? `outstanding-documents/${rest}` : "outstanding-documents";
  return { slug: params.slug, path, ok: isDocsPath(path) };
}

// The file as uploaded, always as a download: it came from outside.
export async function GET(_req: Request, ctx: Ctx) {
  if (!await getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const t = await target(ctx);
  const m = /^outstanding-documents\/uploads\/([0-9a-f-]{36})\/file$/i.exec(t.path);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const upstream = await fetchUploadFile(t.slug, m[1]);
  if (!upstream.ok) return NextResponse.json({ error: `the file could not be fetched (${upstream.status})` }, { status: upstream.status });
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": upstream.headers.get("content-disposition") ?? "attachment",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const t = await target(ctx);
  if (!t.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (t.path === "outstanding-documents/uploads") {
    const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "");
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > MAX_FILE_BYTES) return NextResponse.json({ issues: [`${fileName} is over ${MAX_FILE_BYTES / 1048576} MB`] }, { status: 413 });
    const r = await docsCall(t.slug, t.path, "POST", actorEmail, undefined, { bytes, fileName, contentType: req.headers.get("content-type") ?? "" });
    return NextResponse.json(r.body, { status: r.status });
  }
  const body = await req.json().catch(() => ({}));
  const r = await docsCall(t.slug, t.path, "POST", actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const actorEmail = await getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const t = await target(ctx);
  if (!t.ok || t.path.split("/").length !== 2) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = await docsCall(t.slug, t.path, "PATCH", actorEmail, body);
  return NextResponse.json(r.body, { status: r.status });
}

// Notes on work items and open items. Read and create only: the table refuses
// updates and deletes, so there is deliberately no endpoint for either.

import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { createNote, fetchNotes } from "@/modules/finance/lib/notes";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });

  const result = await fetchNotes({
    slug: params.slug,
    targetType: req.nextUrl.searchParams.get("targetType") ?? undefined,
    targetId: req.nextUrl.searchParams.get("targetId") ?? undefined,
  });

  return result.ok
    ? NextResponse.json({ data: result.data })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const result = await createNote({
    slug: params.slug,
    actorEmail,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
    ...(body as Record<string, unknown>),
  } as Parameters<typeof createNote>[0]);

  return result.ok
    ? NextResponse.json(result.data, { status: 201 })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

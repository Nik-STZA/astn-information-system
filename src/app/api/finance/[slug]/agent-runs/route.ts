import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { listAgentRuns, queueAgentRun } from "@/modules/finance/lib/agent-runs";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  if (!getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const r = await listAgentRuns(params.slug);
  return r.ok
    ? NextResponse.json({ data: r.data })
    : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { agent, instruction } = body as { agent?: string; instruction?: string };
  if (!instruction || !instruction.trim()) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  const r = await queueAgentRun({
    slug: params.slug,
    actorEmail,
    agent,
    instruction,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
  });

  return r.ok
    ? NextResponse.json(r.data, { status: 201 })
    : NextResponse.json({ error: r.error }, { status: r.status });
}

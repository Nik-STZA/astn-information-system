import { NextResponse, type NextRequest } from "next/server";
import { getIapEmail } from "@/lib/auth";
import { listReportRuns, queueReportRun } from "@/modules/finance/lib/report-runs";
import { clientIpFrom } from "@/shared/lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!getIapEmail()) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });
  const report = req.nextUrl.searchParams.get("report") ?? undefined;
  const r = await listReportRuns(params.slug, report);
  return r.ok
    ? NextResponse.json({ data: r.data })
    : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const actorEmail = getIapEmail();
  if (!actorEmail) return NextResponse.json({ error: "unauthenticated" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { report, period } = body as { report?: string; period?: string };
  if (!report || !period) {
    return NextResponse.json({ error: "report and period are required" }, { status: 400 });
  }

  const r = await queueReportRun({
    slug: params.slug,
    actorEmail,
    report,
    period,
    ip: clientIpFrom(req.headers.get("x-forwarded-for")) ?? undefined,
  });

  return r.ok
    ? NextResponse.json(r.data, { status: 201 })
    : NextResponse.json({ error: r.error }, { status: r.status });
}

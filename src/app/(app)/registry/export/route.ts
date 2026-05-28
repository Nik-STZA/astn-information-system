import { NextResponse } from "next/server";
import { fetchAllOrganizationsMatching } from "@/lib/data/registry";
import {
  CONFIDENCE_BANDS,
  type ConfidenceBand,
  type RegistryFilters,
} from "@/lib/data/registry-shared";
import {
  buildRegistryCsv,
  buildRegistryDocx,
  registryExportFilename,
} from "@/lib/reports/registryExport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readParam(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

function readConfidence(value: string | null): ConfidenceBand | null {
  if (!value) return null;
  return (CONFIDENCE_BANDS as readonly string[]).includes(value)
    ? (value as ConfidenceBand)
    : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "docx" ? "docx" : "csv";
  const verifyMode = url.searchParams.get("queue") === "verify";

  const filters: RegistryFilters = {
    country: readParam(url.searchParams.get("country")),
    sport: readParam(url.searchParams.get("sport")),
    type: readParam(url.searchParams.get("type")),
    confidence: readConfidence(url.searchParams.get("confidence")),
  };

  const rows = await fetchAllOrganizationsMatching(filters, { verifyMode });
  const filename = registryExportFilename(format, verifyMode);

  if (format === "csv") {
    return new NextResponse(rows.length === 0 ? "" : buildRegistryCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const buffer = await buildRegistryDocx(rows, filters, verifyMode, rows.length);
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

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { confidenceBand, type OrganizationDetail, type RegistryFilters } from "@/lib/data/registry-shared";

/**
 * Bulk filtered exports of the registry. CSV is the lossless data-dump
 * format for analysis in Excel / Sheets; docx is a brand-styled table-shape
 * summary for sharing as a readable document.
 *
 * Both share the same row source (fetchAllOrganizationsMatching) so they
 * stay consistent and apply the same filter logic the registry UI uses.
 */

const BRAND_DARK = "1A1C1E";
const BRAND_GOLD = "C5A059";
const WARM_GREY = "8E9196";
const GOLD_BORDER = "D4C5A9";

// Soft cap on docx row count - past this the file is unwieldy. CSV has no cap.
export const DOCX_EXPORT_ROW_CAP = 1000;

const CSV_COLUMNS: Array<{ header: string; get: (o: OrganizationDetail) => string | null }> = [
  { header: "AfricanSTN ID", get: (o) => o.astn_id },
  { header: "Organisation", get: (o) => o.organization_name },
  { header: "Country", get: (o) => o.country },
  { header: "Country ISO", get: (o) => o.country_iso },
  { header: "Region / province", get: (o) => o.region_province },
  { header: "Sport", get: (o) => o.sport },
  { header: "Sport code", get: (o) => o.sport_code },
  { header: "Level", get: (o) => o.level },
  { header: "Organisation type", get: (o) => o.organization_type },
  { header: "Status", get: (o) => o.status },
  { header: "Confidence band", get: (o) => confidenceBand(o.source_confidence) },
  { header: "Source confidence (raw)", get: (o) => o.source_confidence },
  { header: "Verification date", get: (o) => o.verification_date },
  { header: "Source label", get: (o) => o.verification_source_label },
  { header: "Verification source", get: (o) => o.verification_source },
  { header: "Primary source", get: (o) => o.verification_source_primary },
  { header: "Cross-reference", get: (o) => o.verification_source_xref },
  { header: "Organisation website", get: (o) => o.organization_website },
  { header: "National body website", get: (o) => o.national_body_website },
  { header: "Contact email", get: (o) => o.contact_email },
  { header: "Contact phone", get: (o) => o.contact_phone },
  { header: "Social media", get: (o) => o.social_media },
  { header: "Partnership type", get: (o) => o.partnership_type },
  { header: "Commercial priority", get: (o) => o.commercial_priority },
  { header: "Outreach candidate", get: (o) => o.outreach_candidate },
  { header: "Owner", get: (o) => o.owner },
  { header: "Review date", get: (o) => o.review_date },
  { header: "AfricanSTN vertical", get: (o) => o.astn_vertical },
  { header: "Tags", get: (o) => o.tags },
  { header: "Notes", get: (o) => o.notes },
  { header: "Next action", get: (o) => o.next_action },
  { header: "Parent national body", get: (o) => o.parent_national_body },
  { header: "Continental body", get: (o) => o.continental_body },
  { header: "Created at", get: (o) => o.created_at },
  { header: "Updated at", get: (o) => o.updated_at },
];

// RFC 4180 quoting: any field with comma, quote, CR, or LF gets wrapped in
// double quotes; internal quotes are doubled.
function csvEscape(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildRegistryCsv(rows: OrganizationDetail[]): string {
  const headerLine = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(",");
  const dataLines = rows.map((row) =>
    CSV_COLUMNS.map((c) => csvEscape(c.get(row))).join(","),
  );
  // CRLF line endings for maximum Excel compatibility.
  // BOM prefix so Excel recognises UTF-8 (Arabic / accents render correctly).
  return "﻿" + [headerLine, ...dataLines].join("\r\n") + "\r\n";
}

function plain(text: string, opts: { color?: string; bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({
    text,
    font: "Calibri",
    color: opts.color,
    bold: opts.bold,
    size: opts.size,
  });
}

function describeFilters(filters: RegistryFilters, verifyMode: boolean): string[] {
  const out: string[] = [];
  if (verifyMode) out.push("Verification queue (non-High confidence)");
  if (filters.country) out.push(`Country: ${filters.country}`);
  if (filters.sport) out.push(`Sport: ${filters.sport}`);
  if (filters.type) out.push(`Type: ${filters.type}`);
  if (filters.confidence) out.push(`Confidence: ${filters.confidence}`);
  if (out.length === 0) out.push("No filters - full registry");
  return out;
}

function todayLong(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const DOCX_COLUMNS: Array<{
  header: string;
  widthPct: number;
  get: (o: OrganizationDetail) => string;
}> = [
  { header: "Organisation", widthPct: 28, get: (o) => o.organization_name ?? "—" },
  { header: "Country", widthPct: 14, get: (o) => o.country ?? "—" },
  { header: "Sport", widthPct: 14, get: (o) => o.sport ?? "—" },
  { header: "Type", widthPct: 18, get: (o) => o.organization_type ?? "—" },
  {
    header: "Confidence",
    widthPct: 12,
    get: (o) => confidenceBand(o.source_confidence) ?? "—",
  },
  { header: "Owner", widthPct: 14, get: (o) => o.owner ?? "—" },
];

function headerRow(): TableRow {
  return new TableRow({
    tableHeader: true,
    children: DOCX_COLUMNS.map(
      (c) =>
        new TableCell({
          width: { size: c.widthPct, type: WidthType.PERCENTAGE },
          shading: { fill: BRAND_DARK },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [plain(c.header.toUpperCase(), { color: "FFFFFF", bold: true, size: 16 })],
            }),
          ],
        }),
    ),
  });
}

function bodyRow(org: OrganizationDetail, zebra: boolean): TableRow {
  return new TableRow({
    children: DOCX_COLUMNS.map(
      (c) =>
        new TableCell({
          width: { size: c.widthPct, type: WidthType.PERCENTAGE },
          shading: zebra ? { fill: "F5F0E8" } : undefined,
          verticalAlign: VerticalAlign.TOP,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [plain(c.get(org), { color: BRAND_DARK, size: 20 })],
            }),
          ],
        }),
    ),
  });
}

export async function buildRegistryDocx(
  rows: OrganizationDetail[],
  filters: RegistryFilters,
  verifyMode: boolean,
  totalAvailable: number,
): Promise<Buffer> {
  const capped = rows.length > DOCX_EXPORT_ROW_CAP;
  const displayed = capped ? rows.slice(0, DOCX_EXPORT_ROW_CAP) : rows;

  const head: Paragraph[] = [
    new Paragraph({
      spacing: { after: 80 },
      children: [plain("AfricanSTN registry export", { color: WARM_GREY, size: 18 })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
      children: [
        plain(verifyMode ? "Verification queue" : "Filtered registry list", {
          color: BRAND_DARK,
          bold: true,
          size: 36,
        }),
      ],
    }),
  ];

  for (const line of describeFilters(filters, verifyMode)) {
    head.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [plain(line, { color: WARM_GREY, size: 20 })],
      }),
    );
  }

  head.push(
    new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [
        plain(
          `${displayed.length.toLocaleString("en-GB")} of ${totalAvailable.toLocaleString("en-GB")} organisations${capped ? ` (capped at ${DOCX_EXPORT_ROW_CAP.toLocaleString("en-GB")} - narrow the filters or use the CSV export for the full set)` : ""}`,
          { color: BRAND_GOLD, bold: true, size: 20 },
        ),
      ],
    }),
  );

  const goldBorder = { style: BorderStyle.SINGLE, size: 4, color: GOLD_BORDER };
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: goldBorder,
      bottom: goldBorder,
      left: goldBorder,
      right: goldBorder,
      insideHorizontal: goldBorder,
      insideVertical: goldBorder,
    },
    rows: [headerRow(), ...displayed.map((o, i) => bodyRow(o, i % 2 === 1))],
  });

  const doc = new Document({
    creator: "STZA AfricanSTN information system",
    title: "AfricanSTN registry export",
    styles: {
      default: { document: { run: { font: "Calibri", color: BRAND_DARK, size: 22 } } },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  plain(`Generated ${todayLong()}  ·  STZA AfricanSTN  ·  Internal use only`, {
                    color: WARM_GREY,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...head, table],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function registryExportFilename(format: "csv" | "docx", verifyMode: boolean): string {
  const today = new Date().toISOString().slice(0, 10);
  const base = verifyMode ? "AfricanSTN_verification_queue" : "AfricanSTN_registry";
  return `${base}_${today}.${format}`;
}

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  BorderStyle,
} from "docx";
import { confidenceBand, type OrganizationDetail } from "@/lib/data/registry-shared";

/**
 * STZA brand-styled organisation profile in .docx.
 *
 * Tokens kept in sync with src/styles/globals.css and tailwind.config.ts.
 * Calibri throughout. Empty fields are omitted so the doc stays tight.
 */

const BRAND_DARK = "1A1C1E";
const BRAND_GOLD = "C5A059";
const WARM_GREY = "8E9196";
const GOLD_BORDER = "D4C5A9";

type Field = { label: string; value: string | null };

function nonEmpty(fields: Field[]): Array<{ label: string; value: string }> {
  return fields
    .map((f) => ({ label: f.label, value: (f.value ?? "").trim() }))
    .filter((f) => f.value.length > 0);
}

function formatDateLong(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // Brand rule: "28 May 2026" - no ordinals.
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 },
    children: [plain(text, { color: BRAND_GOLD, bold: true, size: 28 })],
  });
}

function fieldRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 32, type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [
          new Paragraph({
            children: [plain(label.toUpperCase(), { color: WARM_GREY, bold: true, size: 16 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 68, type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.TOP,
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [
          new Paragraph({
            children: [plain(value, { color: BRAND_DARK, size: 22 })],
          }),
        ],
      }),
    ],
  });
}

function fieldTable(rows: Array<{ label: string; value: string }>): Table {
  const goldBorder = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: GOLD_BORDER,
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: goldBorder,
      bottom: goldBorder,
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: goldBorder,
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: rows.map((r) => fieldRow(r.label, r.value)),
  });
}

function confidenceLabel(org: OrganizationDetail): string {
  const band = confidenceBand(org.source_confidence);
  if (!band) return "Unverified";
  return `${band} confidence`;
}

async function loadLogoBytes(): Promise<Buffer | null> {
  try {
    const p = path.join(process.cwd(), "public", "logos", "protea-mono-gold.png");
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

export async function buildOrganizationProfileDocx(org: OrganizationDetail): Promise<Buffer> {
  const logoBytes = await loadLogoBytes();

  const heading: Paragraph[] = [];

  if (logoBytes) {
    heading.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: logoBytes,
            transformation: { width: 36, height: 36 },
            type: "png",
          }),
        ],
      }),
    );
  }

  heading.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [plain("AfricanSTN organisation profile", { color: WARM_GREY, size: 18 })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
      children: [
        plain(org.organization_name ?? "Untitled organisation", {
          color: BRAND_DARK,
          bold: true,
          size: 44,
        }),
      ],
    }),
  );

  const breadcrumb = [org.country, org.sport, org.organization_type]
    .filter((v): v is string => !!v && v.length > 0)
    .join("  ·  ");
  if (breadcrumb) {
    heading.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [plain(breadcrumb, { color: WARM_GREY, size: 22 })],
      }),
    );
  }

  heading.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [plain(confidenceLabel(org), { color: BRAND_GOLD, bold: true, size: 18 })],
    }),
  );

  const sections: Array<{ title: string; rows: Field[] }> = [
    {
      title: "Identification",
      rows: [
        { label: "AfricanSTN ID", value: org.astn_id },
        { label: "Organisation type", value: org.organization_type },
        { label: "Status", value: org.status },
        { label: "AfricanSTN vertical", value: org.astn_vertical },
      ],
    },
    {
      title: "Location & classification",
      rows: [
        { label: "Country", value: org.country },
        { label: "Region / province", value: org.region_province },
        { label: "Sport", value: org.sport },
        { label: "Level", value: org.level },
        { label: "Parent national body", value: org.parent_national_body },
        { label: "Continental body", value: org.continental_body },
      ],
    },
    {
      title: "Web & contact",
      rows: [
        { label: "Organisation website", value: org.organization_website },
        { label: "National body website", value: org.national_body_website },
        { label: "Contact email", value: org.contact_email },
        { label: "Contact phone", value: org.contact_phone },
        { label: "Social media", value: org.social_media },
      ],
    },
    {
      title: "Partnership & outreach",
      rows: [
        { label: "Partnership type", value: org.partnership_type },
        { label: "Commercial priority", value: org.commercial_priority },
        { label: "Outreach candidate", value: org.outreach_candidate },
        { label: "Owner", value: org.owner },
        { label: "Review date", value: org.review_date },
        { label: "Next action", value: org.next_action },
      ],
    },
    {
      title: "Notes & tags",
      rows: [
        { label: "Tags", value: org.tags },
        { label: "Notes", value: org.notes },
      ],
    },
    {
      title: "Verification",
      rows: [
        { label: "Source confidence", value: org.source_confidence },
        { label: "Verification source", value: org.verification_source },
        { label: "Primary source", value: org.verification_source_primary },
        { label: "Cross-reference", value: org.verification_source_xref },
        { label: "Source label", value: org.verification_source_label },
        { label: "Verification date", value: org.verification_date },
        { label: "Data source", value: org.data_source },
      ],
    },
  ];

  const body: Array<Paragraph | Table> = [...heading];

  for (const section of sections) {
    const rows = nonEmpty(section.rows);
    if (rows.length === 0) continue;
    body.push(sectionHeading(section.title));
    body.push(fieldTable(rows));
  }

  const generatedOn = formatDateLong(new Date().toISOString()) ?? "";

  const doc = new Document({
    creator: "STZA AfricanSTN information system",
    title: org.organization_name ?? "AfricanSTN organisation profile",
    styles: {
      default: {
        document: {
          run: { font: "Calibri", color: BRAND_DARK, size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 900, right: 900 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  plain(`Generated ${generatedOn}  ·  STZA AfricanSTN  ·  Internal use only`, {
                    color: WARM_GREY,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// Slug for the download filename. Avoids spaces / punctuation that
// confuse browsers and downstream tooling.
export function profileFilename(org: OrganizationDetail): string {
  const base = (org.organization_name ?? "organisation")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "organisation";
  const today = new Date().toISOString().slice(0, 10);
  return `AfricanSTN_${base}_profile_${today}.docx`;
}

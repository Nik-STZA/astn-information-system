/**
 * Amendment Schedule (redline pack) — Word document generator.
 *
 * Renders the confirmed dual-model resolutions for a client as a defensible advisory deliverable:
 * per document, per clause, "current gap -> proposed wording", each carrying its regime, citation,
 * severity and [Statutory]/[Enhancement] classification. The client's counsel applies the accepted
 * changes — this is a change schedule, not a machine-rewrite of their file.
 *
 * Part of the OS document-generation module (mode 1). Reuses the shared resolution parser so the
 * schedule reflects exactly what the ResolutionPanel shows, including human edits.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
} from "docx";
import { parseResolution, parseGapTag } from "@/lib/resolution-parse";

const BRAND_DARK = "1A1C1E";
const BRAND_GOLD = "C5A059";
const WARM_GREY = "8E9196";
const GOLD_BORDER = "D4C5A9";
const ALERT_RED = "CC0000";
const WARN_AMBER = "CC7700";
const FONT = "Calibri";

export type AmendmentChange = {
  remediation_id: number;
  jurisdiction_code: string;
  jurisdiction_name: string;
  requirement: string;
  legal_reference: string | null;
  severity: string | null;
  finding_status: string | null;
  resolution_status: string;
  agreement: string | null;
  reviewed_by: string | null;
  resolution: string;
};

export type AmendmentDocument = {
  document_type: string;
  document_label: string;
  document_title: string;
  changes: AmendmentChange[];
};

export type AmendmentScheduleData = {
  client: { company_name: string; company_country?: string | null; ir_registration_number?: string | null };
  generated_at: string;
  include_drafts: boolean;
  total_changes: number;
  documents: AmendmentDocument[];
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function run(text: string, opts: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) {
  return new TextRun({ text, font: FONT, bold: opts.bold, color: opts.color, italics: opts.italics, size: opts.size ?? 20 });
}

function label(text: string) {
  return new Paragraph({
    spacing: { before: 160, after: 40 },
    children: [new TextRun({ text: text.toUpperCase(), font: FONT, bold: true, size: 16, color: WARM_GREY, characterSpacing: 12 })],
  });
}

export async function generateAmendmentSchedule(data: AmendmentScheduleData): Promise<Blob> {
  const children: Paragraph[] = [];

  // ── Title ────────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: "Amendment Schedule", font: FONT, bold: true, size: 44, color: BRAND_DARK })],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: data.client.company_name, font: FONT, size: 26, color: BRAND_GOLD })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD_BORDER, space: 6 } },
      children: [
        run(`Generated ${fmtDate(data.generated_at)}`, { color: WARM_GREY }),
        run(`   ·   ${data.total_changes} proposed amendment${data.total_changes === 1 ? "" : "s"} across ${data.documents.length} document${data.documents.length === 1 ? "" : "s"}`, { color: WARM_GREY }),
      ],
    }),
  );

  // ── Status / disclaimer banner ───────────────────────────────────────────
  const banner = data.include_drafts
    ? "PRELIMINARY — includes unconfirmed draft resolutions. Not for issue until each amendment is reviewed and approved."
    : "Confirmed amendments only. Advisory deliverable — the client's legal counsel should review and adopt.";
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      shading: { type: ShadingType.SOLID, color: data.include_drafts ? "FBECDD" : "F5F0E8", fill: data.include_drafts ? "FBECDD" : "F5F0E8" },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: data.include_drafts ? WARN_AMBER : BRAND_GOLD, space: 8 } },
      children: [run(banner, { color: BRAND_DARK, italics: true })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [run("This schedule proposes specific, clause-level amendments to the client's existing documents. It is regulatory-lens advisory, not legal advice; each redraft is a draft pending the client's own legal review. Statutory items reflect obligations the law imposes; Enhancement items are best-practice improvements, not compliance failures.", { color: WARM_GREY, size: 18 })],
    }),
  );

  if (!data.documents.length) {
    children.push(new Paragraph({ children: [run("No amendments to schedule. Confirm resolutions on the remediation board first (or preview with drafts included).", { color: WARM_GREY, italics: true })] }));
  }

  // ── Per document ─────────────────────────────────────────────────────────
  for (const doc of data.documents) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 40 },
        children: [new TextRun({ text: doc.document_title, font: FONT, bold: true, size: 28, color: BRAND_DARK })],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [run(`${doc.document_label} · ${doc.changes.length} amendment${doc.changes.length === 1 ? "" : "s"}`, { color: BRAND_GOLD, size: 18 })],
      }),
    );

    doc.changes.forEach((ch, idx) => {
      const parsed = parseResolution(ch.resolution || "");

      // Change header line
      const meta: string[] = [ch.jurisdiction_name];
      if (ch.legal_reference) meta.push(ch.legal_reference);
      if (ch.severity) meta.push(ch.severity);
      meta.push(ch.resolution_status);
      children.push(
        new Paragraph({
          spacing: { before: 220, after: 20 },
          keepNext: true,
          children: [new TextRun({ text: `${idx + 1}. ${ch.requirement}`, font: FONT, bold: true, size: 24, color: BRAND_DARK })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          children: [run(meta.join("  ·  "), { color: WARM_GREY, size: 18 })],
        }),
      );

      if (parsed.summary) {
        children.push(new Paragraph({ spacing: { after: 80 }, children: [run(parsed.summary, { color: BRAND_DARK })] }));
      }

      // Gaps with statutory/enhancement tags
      if (parsed.gaps.length) {
        children.push(label("Gaps & enhancements"));
        for (const g of parsed.gaps) {
          const { tag, text } = parseGapTag(g);
          const tagColor = tag === "Statutory" ? ALERT_RED : tag === "Enhancement" ? WARN_AMBER : WARM_GREY;
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 40 },
              children: [
                ...(tag ? [new TextRun({ text: `[${tag}] `, font: FONT, bold: true, size: 18, color: tagColor })] : []),
                run(text, { color: BRAND_DARK }),
              ],
            }),
          );
        }
      }

      // Proposed redraft
      if (parsed.redraft) {
        children.push(label("Proposed wording — draft, pending client legal review"));
        for (const line of parsed.redraft.split("\n")) {
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              indent: { left: 240 },
              border: { left: { style: BorderStyle.SINGLE, size: 14, color: BRAND_GOLD, space: 10 } },
              children: [run(line || " ", { color: BRAND_DARK })],
            }),
          );
        }
      }

      if (parsed.citations.length) {
        children.push(
          new Paragraph({
            spacing: { before: 60, after: 40 },
            children: [run("Cites: ", { bold: true, color: WARM_GREY, size: 18 }), run(parsed.citations.join(";  "), { color: WARM_GREY, size: 18 })],
          }),
        );
      }
    });
  }

  const doc = new Document({
    creator: "AfricanSTN Compliance OS",
    title: `Amendment Schedule — ${data.client.company_name}`,
    styles: { default: { document: { run: { font: FONT, size: 20, color: BRAND_DARK } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [run("Regulatory-lens advisory — not legal advice. Each amendment is a draft pending the client's own legal review.", { color: WARM_GREY, size: 14 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

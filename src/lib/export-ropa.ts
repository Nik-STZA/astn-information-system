/**
 * ROPA (Record of Processing Activities) Word document export.
 *
 * Generates a branded .docx file from the client's processing activities,
 * formatted per POPIA s14 / GDPR Art 30 requirements.
 *
 * Uses the `docx` npm package (already a project dependency).
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  PageBreak,
  ShadingType,
} from "docx";

import type { ProcessingActivity, SpecialCategory } from "./data/client-management";

// ─── Brand colours ──────────────────────────────────────────────────────────

const BRAND_GOLD = "C5A059";
const BRAND_DARK = "1A1C1E";
const WARM_GREY = "8E9196";
const WARM_LIGHT = "F5F0E8";
const WHITE = "FFFFFF";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: BRAND_DARK },
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({
            text,
            bold: true,
            size: 18,
            color: WHITE,
            font: "Calibri",
          }),
        ],
      }),
    ],
  });
}

function dataCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    children: [
      new Paragraph({
        spacing: { before: 30, after: 30 },
        children: [
          new TextRun({
            text: text || "—",
            size: 18,
            color: BRAND_DARK,
            font: "Calibri",
          }),
        ],
      }),
    ],
  });
}

function labelValueRow(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [
      new TextRun({
        text: `${label}: `,
        bold: true,
        size: 20,
        color: BRAND_DARK,
        font: "Calibri",
      }),
      new TextRun({
        text: value || "—",
        size: 20,
        color: BRAND_DARK,
        font: "Calibri",
      }),
    ],
  });
}

// ─── Main export function ───────────────────────────────────────────────────

export async function exportROPA({
  clientName,
  activities,
  specialCategories,
}: {
  clientName: string;
  activities: ProcessingActivity[];
  specialCategories: SpecialCategory[];
}): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ─── Cover / header section ───────────────────────────────────────────

  const coverSection: Paragraph[] = [
    new Paragraph({
      spacing: { before: 600, after: 200 },
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: "Record of Processing Activities",
          bold: true,
          size: 48,
          color: BRAND_DARK,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: clientName,
          bold: true,
          size: 32,
          color: BRAND_GOLD,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `Prepared ${dateStr} · POPIA s14 / GDPR Art 30`,
          size: 20,
          color: WARM_GREY,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `${activities.length} processing activities documented · ${activities.filter((a) => a.status === "active").length} active`,
          size: 20,
          color: WARM_GREY,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 6,
          color: BRAND_GOLD,
          space: 1,
        },
      },
      children: [],
    }),
    new Paragraph({
      spacing: { before: 200, after: 400 },
      children: [
        new TextRun({
          text: "Prepared by AfricanSTN on behalf of the responsible party in accordance with the Protection of Personal Information Act, 2013 (POPIA). This register should be reviewed at least annually and updated whenever processing activities change materially.",
          size: 20,
          color: WARM_GREY,
          font: "Calibri",
          italics: true,
        }),
      ],
    }),
  ];

  // ─── Summary table ────────────────────────────────────────────────────

  const COL_WIDTHS = [2800, 2200, 2400, 1600, 1500];
  const TABLE_WIDTH = COL_WIDTHS.reduce((s, w) => s + w, 0);

  const summaryHeaderRow = new TableRow({
    children: [
      headerCell("Activity", COL_WIDTHS[0]),
      headerCell("Legal basis", COL_WIDTHS[1]),
      headerCell("Purpose", COL_WIDTHS[2]),
      headerCell("Cross-border", COL_WIDTHS[3]),
      headerCell("Status", COL_WIDTHS[4]),
    ],
  });

  const summaryDataRows = activities.map(
    (a, idx) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: COL_WIDTHS[0], type: WidthType.DXA },
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: WARM_LIGHT } : undefined,
            children: [
              new Paragraph({
                spacing: { before: 30, after: 30 },
                children: [
                  new TextRun({
                    text: a.activity_name,
                    bold: true,
                    size: 18,
                    color: BRAND_DARK,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: COL_WIDTHS[1], type: WidthType.DXA },
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: WARM_LIGHT } : undefined,
            children: [
              new Paragraph({
                spacing: { before: 30, after: 30 },
                children: [
                  new TextRun({
                    text: (a.legal_basis || "—").replace(/_/g, " "),
                    size: 18,
                    color: BRAND_DARK,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: COL_WIDTHS[2], type: WidthType.DXA },
            shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: WARM_LIGHT } : undefined,
            children: [
              new Paragraph({
                spacing: { before: 30, after: 30 },
                children: [
                  new TextRun({
                    text: a.purpose || "—",
                    size: 18,
                    color: BRAND_DARK,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
          dataCell(a.cross_border ? "Yes" : "No", COL_WIDTHS[3]),
          dataCell(a.status.replace(/_/g, " "), COL_WIDTHS[4]),
        ],
      })
  );

  const summaryTable = new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: COL_WIDTHS,
    rows: [summaryHeaderRow, ...summaryDataRows],
  });

  // ─── Detailed activity pages ──────────────────────────────────────────

  const activityDetails: Paragraph[] = [];

  activities.forEach((a, idx) => {
    if (idx > 0) {
      activityDetails.push(
        new Paragraph({ children: [new PageBreak()] })
      );
    }

    activityDetails.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: `${idx + 1}. ${a.activity_name}`,
            bold: true,
            size: 26,
            color: BRAND_DARK,
            font: "Calibri",
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 60 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 4,
            color: BRAND_GOLD,
            space: 1,
          },
        },
        children: [],
      }),
    );

    if (a.description) {
      activityDetails.push(labelValueRow("Description", a.description));
    }
    activityDetails.push(labelValueRow("Purpose", a.purpose));
    activityDetails.push(
      labelValueRow("Legal basis", (a.legal_basis || "").replace(/_/g, " "))
    );
    if (a.legal_basis_detail) {
      activityDetails.push(labelValueRow("Legal basis detail", a.legal_basis_detail));
    }
    activityDetails.push(
      labelValueRow("Status", a.status.replace(/_/g, " "))
    );

    // Data categories
    if (a.personal_data_types && a.personal_data_types.length > 0) {
      activityDetails.push(
        labelValueRow("Personal data types", a.personal_data_types.join(", "))
      );
    }
    if (a.data_subject_categories && a.data_subject_categories.length > 0) {
      activityDetails.push(
        labelValueRow(
          "Data subject categories",
          a.data_subject_categories.join(", ")
        )
      );
    }
    if (a.estimated_volume) {
      activityDetails.push(labelValueRow("Estimated volume", a.estimated_volume));
    }

    // Retention
    if (a.retention_period) {
      activityDetails.push(labelValueRow("Retention period", a.retention_period));
    }
    if (a.retention_basis) {
      activityDetails.push(labelValueRow("Retention basis", a.retention_basis));
    }

    // Recipients and transfers
    if (a.recipients && a.recipients.length > 0) {
      activityDetails.push(
        labelValueRow("Recipients", a.recipients.join(", "))
      );
    }
    activityDetails.push(
      labelValueRow("Cross-border transfer", a.cross_border ? "Yes" : "No")
    );
    if (a.cross_border && a.transfer_countries && a.transfer_countries.length > 0) {
      activityDetails.push(
        labelValueRow("Transfer countries", a.transfer_countries.join(", "))
      );
    }
    if (a.transfer_mechanism) {
      activityDetails.push(
        labelValueRow("Transfer mechanism", a.transfer_mechanism)
      );
    }

    // Security
    if (a.security_measures) {
      activityDetails.push(
        labelValueRow("Security measures", a.security_measures)
      );
    }

    // Review
    if (a.last_reviewed) {
      activityDetails.push(
        labelValueRow("Last reviewed", fmtDate(a.last_reviewed))
      );
    }
  });

  // ─── Special categories appendix ──────────────────────────────────────

  const scSection: Paragraph[] = [];
  const processedCategories = specialCategories.filter(
    (sc) => sc.is_processed === true
  );

  if (processedCategories.length > 0) {
    scSection.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: "Appendix: Special personal information (POPIA s26-33)",
            bold: true,
            size: 30,
            color: BRAND_DARK,
            font: "Calibri",
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 200 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: BRAND_GOLD,
            space: 1,
          },
        },
        children: [],
      })
    );

    processedCategories.forEach((sc) => {
      scSection.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 60 },
          children: [
            new TextRun({
              text: sc.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              bold: true,
              size: 22,
              color: BRAND_DARK,
              font: "Calibri",
            }),
          ],
        }),
        labelValueRow("Compliance status", sc.compliance_status.replace(/_/g, " ")),
      );
      if (sc.processing_description) {
        scSection.push(labelValueRow("Processing description", sc.processing_description));
      }
      if (sc.volume_estimate) {
        scSection.push(labelValueRow("Volume estimate", sc.volume_estimate));
      }
      if (sc.legal_basis) {
        scSection.push(labelValueRow("Legal basis", sc.legal_basis));
      }
      if (sc.safeguards) {
        scSection.push(labelValueRow("Safeguards", sc.safeguards));
      }
      if (sc.prior_auth_status && sc.prior_auth_status !== "not_required") {
        scSection.push(
          labelValueRow("Prior authorisation", sc.prior_auth_status.replace(/_/g, " "))
        );
        if (sc.prior_auth_reference) {
          scSection.push(labelValueRow("Prior auth reference", sc.prior_auth_reference));
        }
      }
      if (sc.assessor_notes) {
        scSection.push(labelValueRow("Assessor notes", sc.assessor_notes));
      }
      if (sc.last_assessed) {
        scSection.push(labelValueRow("Last assessed", fmtDate(sc.last_assessed)));
      }
    });
  }

  // ─── Assemble document ────────────────────────────────────────────────

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri",
            size: 20,
            color: BRAND_DARK,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: [
          ...coverSection,
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 200 },
            children: [
              new TextRun({
                text: "Processing activities summary",
                bold: true,
                size: 30,
                color: BRAND_DARK,
                font: "Calibri",
              }),
            ],
          }),
          summaryTable,
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 200 },
            children: [
              new TextRun({
                text: "Detailed processing activities",
                bold: true,
                size: 30,
                color: BRAND_DARK,
                font: "Calibri",
              }),
            ],
          }),
          ...activityDetails,
          ...scSection,
        ],
      },
    ],
  });

  // ─── Generate and download ────────────────────────────────────────────

  const blob = await Packer.toBlob(doc);
  const safeName = clientName.replace(/[^a-zA-Z0-9]/g, "_");
  const filename = `ROPA_${safeName}_${now.toISOString().slice(0, 10)}.docx`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

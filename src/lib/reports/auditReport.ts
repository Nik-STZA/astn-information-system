/**
 * POPIA Compliance Audit Report — Word document generator.
 *
 * Creates a professional audit report summarising:
 *  - Client details and engagement overview
 *  - Remediation status summary
 *  - Itemised remediation findings with status and actions taken
 *  - Full audit trail (chronological)
 *
 * Designed to be defensible if presented to the Information Regulator,
 * a client board, or any other stakeholder.
 */

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
  ShadingType,
  PageBreak,
} from "docx";
import type { RemediationItem, AuditEntry } from "@/lib/data/remediation";

/* ── Brand constants ───────────────────────────────────────────────────────── */

const BRAND_DARK = "1A1C1E";
const BRAND_GOLD = "C5A059";
const WARM_GREY = "8E9196";
const GOLD_BORDER = "D4C5A9";
const WARM_LIGHT = "F5F0E8";
const ALERT_RED = "CC0000";
const SUCCESS_GREEN = "2E7D32";
const WARNING_AMBER = "CC7700";

const SEVERITY_COLORS: Record<string, string> = {
  critical: ALERT_RED,
  high: WARNING_AMBER,
  medium: "A67514",
  low: WARM_GREY,
  info: WARM_GREY,
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  verified: "Verified",
  not_applicable: "N/A",
  accepted_risk: "Accepted risk",
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill: WARM_LIGHT },
    borders: {
      bottom: { style: BorderStyle.SINGLE, size: 1, color: GOLD_BORDER },
    },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: true,
            font: "Calibri",
            size: 18,
            color: BRAND_DARK,
          }),
        ],
        spacing: { before: 60, after: 60 },
      }),
    ],
  });
}

function dataCell(text: string, width: number, color?: string): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "E8E0D0" },
    },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            font: "Calibri",
            size: 18,
            color: color || BRAND_DARK,
          }),
        ],
        spacing: { before: 40, after: 40 },
      }),
    ],
  });
}

/* ── Main export ───────────────────────────────────────────────────────────── */

export interface AuditReportInput {
  companyName: string;
  clientStatus: string;
  serviceTier: string | null;
  contactName: string | null;
  contactEmail: string | null;
  items: RemediationItem[];
  audit: AuditEntry[];
  generatedBy: string;
}

export async function generateAuditReport(input: AuditReportInput): Promise<Blob> {
  const {
    companyName,
    clientStatus,
    serviceTier,
    contactName,
    contactEmail,
    items,
    audit,
    generatedBy,
  } = input;

  const now = new Date();
  const reportDate = formatDate(now.toISOString());

  // ── Stats ──────────────────────────────────────────────────────────────
  const total = items.length;
  const openCount = items.filter((i) => i.status === "open").length;
  const inProgressCount = items.filter((i) => i.status === "in_progress").length;
  const resolvedCount = items.filter((i) => i.status === "resolved").length;
  const verifiedCount = items.filter((i) => i.status === "verified").length;
  const naCount = items.filter((i) => i.status === "not_applicable").length;
  const acceptedCount = items.filter((i) => i.status === "accepted_risk").length;
  const criticalOpen = items.filter(
    (i) => (i.status === "open" || i.status === "in_progress") && i.severity === "critical"
  ).length;
  const highOpen = items.filter(
    (i) => (i.status === "open" || i.status === "in_progress") && i.severity === "high"
  ).length;
  const completionPct = total > 0 ? Math.round(((resolvedCount + verifiedCount) / total) * 100) : 0;

  // ── Sections ───────────────────────────────────────────────────────────
  const sections: Paragraph[] = [];

  // Title
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "POPIA Compliance Audit Report",
          bold: true,
          font: "Calibri",
          size: 48,
          color: BRAND_DARK,
        }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: companyName,
          bold: true,
          font: "Calibri",
          size: 32,
          color: BRAND_GOLD,
        }),
      ],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Prepared by AfricanSTN on ${reportDate}`,
          font: "Calibri",
          size: 20,
          color: WARM_GREY,
        }),
      ],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated by: ${generatedBy}`,
          font: "Calibri",
          size: 20,
          color: WARM_GREY,
        }),
      ],
      spacing: { after: 200 },
    }),
    // Disclaimer
    new Paragraph({
      children: [
        new TextRun({
          text: "CONFIDENTIAL — ",
          bold: true,
          font: "Calibri",
          size: 18,
          color: ALERT_RED,
        }),
        new TextRun({
          text: "This report contains compliance assessment findings and remediation activities. It is prepared for the client and authorised stakeholders only. Distribution to third parties requires prior written consent.",
          font: "Calibri",
          size: 18,
          color: WARM_GREY,
          italics: true,
        }),
      ],
      spacing: { after: 300 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 2, color: GOLD_BORDER },
      },
    })
  );

  // ── 1. Executive summary ───────────────────────────────────────────────
  sections.push(
    new Paragraph({
      text: "1. Executive summary",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 120 },
    })
  );

  // Client details
  const clientDetails = [
    ["Company", companyName],
    ["Status", clientStatus],
    ["Service tier", serviceTier || "—"],
    ["Contact", contactName || "—"],
    ["Email", contactEmail || "—"],
    ["Report date", reportDate],
  ];

  const detailsTable = new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [2500, 6500],
    rows: clientDetails.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 2500, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              shading: { type: ShadingType.CLEAR, fill: WARM_LIGHT },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: label, bold: true, font: "Calibri", size: 18, color: BRAND_DARK }),
                  ],
                  spacing: { before: 40, after: 40 },
                }),
              ],
            }),
            new TableCell({
              width: { size: 6500, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: value, font: "Calibri", size: 18, color: BRAND_DARK }),
                  ],
                  spacing: { before: 40, after: 40 },
                }),
              ],
            }),
          ],
        })
    ),
  });

  sections.push(detailsTable as unknown as Paragraph); // docx allows Table in section children

  sections.push(
    new Paragraph({ spacing: { before: 200, after: 100 } }),
  );

  // Summary stats paragraph
  const overallStatus =
    criticalOpen > 0
      ? "CRITICAL items remain outstanding"
      : highOpen > 0
        ? "HIGH severity items remain outstanding"
        : openCount + inProgressCount > 0
          ? "Remediation in progress"
          : "All items resolved or verified";

  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Overall status: ${overallStatus}. `,
          bold: true,
          font: "Calibri",
          size: 20,
          color: criticalOpen > 0 ? ALERT_RED : highOpen > 0 ? WARNING_AMBER : SUCCESS_GREEN,
        }),
        new TextRun({
          text: `Completion: ${completionPct}% (${resolvedCount + verifiedCount} of ${total} items resolved/verified).`,
          font: "Calibri",
          size: 20,
          color: BRAND_DARK,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Open: ${openCount} | In progress: ${inProgressCount} | Resolved: ${resolvedCount} | Verified: ${verifiedCount} | N/A: ${naCount} | Accepted risk: ${acceptedCount}`,
          font: "Calibri",
          size: 18,
          color: WARM_GREY,
        }),
      ],
      spacing: { after: 200 },
    })
  );

  // ── 2. Remediation items ───────────────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: "", break: 1 })],
    }),
    new Paragraph({
      text: "2. Remediation items",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 120 },
    })
  );

  if (items.length === 0) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No remediation items have been generated for this client.",
            font: "Calibri",
            size: 20,
            color: WARM_GREY,
            italics: true,
          }),
        ],
        spacing: { after: 200 },
      })
    );
  } else {
    // Summary table
    const colWidths = [600, 3200, 1200, 1200, 1200, 1600];
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);

    const headerRow = new TableRow({
      children: [
        headerCell("#", colWidths[0]),
        headerCell("Finding", colWidths[1]),
        headerCell("Severity", colWidths[2]),
        headerCell("Status", colWidths[3]),
        headerCell("POPIA ref", colWidths[4]),
        headerCell("Due date", colWidths[5]),
      ],
    });

    const dataRows = items.map((item, idx) =>
      new TableRow({
        children: [
          dataCell(String(idx + 1), colWidths[0]),
          dataCell(item.title, colWidths[1]),
          dataCell(
            item.severity.toUpperCase(),
            colWidths[2],
            SEVERITY_COLORS[item.severity] || WARM_GREY
          ),
          dataCell(STATUS_LABELS[item.status] || item.status, colWidths[3]),
          dataCell(item.popia_reference || "—", colWidths[4]),
          dataCell(item.due_date ? formatDate(item.due_date) : "—", colWidths[5]),
        ],
      })
    );

    sections.push(
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [headerRow, ...dataRows],
      }) as unknown as Paragraph
    );

    // ── 2.1 Detailed findings ──────────────────────────────────────────
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: "", break: 1 })],
      }),
      new Paragraph({
        text: "2.1 Detailed findings",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 120 },
      })
    );

    for (const [idx, item] of items.entries()) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${idx + 1}. ${item.title}`,
              bold: true,
              font: "Calibri",
              size: 22,
              color: BRAND_DARK,
            }),
            new TextRun({
              text: `  [${item.severity.toUpperCase()}]`,
              bold: true,
              font: "Calibri",
              size: 22,
              color: SEVERITY_COLORS[item.severity] || WARM_GREY,
            }),
          ],
          spacing: { before: 160, after: 60 },
        })
      );

      if (item.popia_reference) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `POPIA reference: ${item.popia_reference}`,
                font: "Calibri",
                size: 18,
                color: WARM_GREY,
                italics: true,
              }),
            ],
            spacing: { after: 60 },
          })
        );
      }

      if (item.description) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Finding: ", bold: true, font: "Calibri", size: 18, color: BRAND_DARK }),
              new TextRun({ text: item.description, font: "Calibri", size: 18, color: BRAND_DARK }),
            ],
            spacing: { after: 40 },
          })
        );
      }

      if (item.recommendation) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Recommendation: ", bold: true, font: "Calibri", size: 18, color: BRAND_DARK }),
              new TextRun({ text: item.recommendation, font: "Calibri", size: 18, color: BRAND_DARK }),
            ],
            spacing: { after: 40 },
          })
        );
      }

      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Status: ", bold: true, font: "Calibri", size: 18, color: BRAND_DARK }),
            new TextRun({
              text: STATUS_LABELS[item.status] || item.status,
              font: "Calibri",
              size: 18,
              color:
                item.status === "resolved" || item.status === "verified"
                  ? SUCCESS_GREEN
                  : item.status === "open"
                    ? ALERT_RED
                    : WARNING_AMBER,
            }),
          ],
          spacing: { after: 40 },
        })
      );

      if (item.resolution_summary) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Resolution: ", bold: true, font: "Calibri", size: 18, color: SUCCESS_GREEN }),
              new TextRun({ text: item.resolution_summary, font: "Calibri", size: 18, color: BRAND_DARK }),
            ],
            spacing: { after: 40 },
          })
        );
      }

      // Dates
      const dates: string[] = [];
      if (item.created_at) dates.push(`Created: ${formatDate(item.created_at)}`);
      if (item.started_date) dates.push(`Started: ${formatDate(item.started_date)}`);
      if (item.resolved_date) dates.push(`Resolved: ${formatDate(item.resolved_date)}`);
      if (item.verified_date) dates.push(`Verified: ${formatDate(item.verified_date)} by ${item.verified_by || "—"}`);

      if (dates.length > 0) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: dates.join(" | "),
                font: "Calibri",
                size: 16,
                color: WARM_GREY,
              }),
            ],
            spacing: { after: 100 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "E8E0D0" },
            },
          })
        );
      }
    }
  }

  // ── 3. Audit trail ─────────────────────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: "", break: 1 })],
    }),
    new Paragraph({
      text: "3. Audit trail",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${audit.length} audit entries recorded. All entries are immutable — they cannot be edited or deleted after creation.`,
          font: "Calibri",
          size: 18,
          color: WARM_GREY,
          italics: true,
        }),
      ],
      spacing: { after: 120 },
    })
  );

  if (audit.length > 0) {
    const auditColWidths = [1800, 1400, 3800, 1200, 800];
    const auditTableWidth = auditColWidths.reduce((a, b) => a + b, 0);

    const auditHeaderRow = new TableRow({
      children: [
        headerCell("Date / time", auditColWidths[0]),
        headerCell("Action", auditColWidths[1]),
        headerCell("Description", auditColWidths[2]),
        headerCell("By", auditColWidths[3]),
        headerCell("Change", auditColWidths[4]),
      ],
    });

    const auditDataRows = audit.map(
      (entry) =>
        new TableRow({
          children: [
            dataCell(formatDateTime(entry.performed_at), auditColWidths[0]),
            dataCell(entry.action.replace(/_/g, " "), auditColWidths[1]),
            dataCell(entry.description || "—", auditColWidths[2]),
            dataCell(entry.performed_by, auditColWidths[3]),
            dataCell(
              entry.old_value && entry.new_value
                ? `${entry.old_value} → ${entry.new_value}`
                : "—",
              auditColWidths[4]
            ),
          ],
        })
    );

    sections.push(
      new Table({
        width: { size: auditTableWidth, type: WidthType.DXA },
        columnWidths: auditColWidths,
        rows: [auditHeaderRow, ...auditDataRows],
      }) as unknown as Paragraph
    );
  }

  // ── 4. Appendix ────────────────────────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: "", break: 1 })],
    }),
    new Paragraph({
      text: "4. Document control",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Report generated: ", bold: true, font: "Calibri", size: 18, color: BRAND_DARK }),
        new TextRun({ text: `${reportDate} at ${now.toLocaleTimeString("en-GB")}`, font: "Calibri", size: 18, color: BRAND_DARK }),
      ],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Generated by: ", bold: true, font: "Calibri", size: 18, color: BRAND_DARK }),
        new TextRun({ text: generatedBy, font: "Calibri", size: 18, color: BRAND_DARK }),
      ],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Platform: ", bold: true, font: "Calibri", size: 18, color: BRAND_DARK }),
        new TextRun({ text: "AfricanSTN Information System", font: "Calibri", size: 18, color: BRAND_DARK }),
      ],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "This report is auto-generated from the AfricanSTN compliance management system. All remediation actions and status changes are logged to an immutable audit trail. The integrity of this report depends on the accuracy of data entered by users of the system.",
          font: "Calibri",
          size: 16,
          color: WARM_GREY,
          italics: true,
        }),
      ],
      spacing: { before: 100, after: 200 },
    })
  );

  // ── Build document ─────────────────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 20, color: BRAND_DARK },
        },
        heading1: {
          run: { font: "Calibri", size: 28, bold: true, color: BRAND_DARK },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        heading2: {
          run: { font: "Calibri", size: 24, bold: true, color: BRAND_DARK },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
          },
        },
        children: sections,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `AfricanSTN — POPIA Compliance Audit Report — ${companyName} — ${reportDate}`,
                    font: "Calibri",
                    size: 14,
                    color: WARM_GREY,
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });

  return Packer.toBlob(doc);
}

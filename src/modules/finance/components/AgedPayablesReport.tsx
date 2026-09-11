"use client";

// The interactive half of the AP ageing report: the intercompany toggle,
// expandable supplier rows and the CSV export.
//
// Totals come from finance-api, which sums in pence and per currency. The only
// arithmetic here is taking the intercompany share out when the toggle is on,
// and that is done in pence too so the figures still foot.

import { Fragment, useMemo, useState } from "react";
import type {
  AgeBucket,
  AgedInvoiceRow,
  AgedPayablesReport as Report,
  AgedSupplierRow,
  BucketAmounts,
} from "@/modules/finance/lib/api";

const BUCKETS: Array<{ key: AgeBucket; label: string }> = [
  { key: "current", label: "Current" },
  { key: "1-30", label: "1–30" },
  { key: "31-60", label: "31–60" },
  { key: "61-90", label: "61–90" },
  { key: "90+", label: "90+" },
];

const FONT = "Manrope, sans-serif";

function money(n: number): string {
  if (!n) return "–";
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function minus(a: BucketAmounts, b: BucketAmounts): BucketAmounts {
  const out = {} as BucketAmounts;
  for (const k of Object.keys(a) as Array<keyof BucketAmounts>) {
    out[k] = (Math.round(a[k] * 100) - Math.round((b[k] ?? 0) * 100)) / 100;
  }
  return out;
}

function csvCell(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: AgedInvoiceRow[]) {
  const header = [
    "Entity",
    "Supplier",
    "Invoice number",
    "Reference",
    "Invoice date",
    "Due date",
    "Days overdue",
    "Bucket",
    "Currency",
    "Amount due",
    "Intercompany",
  ];
  const lines = rows.map((r) =>
    [
      r.entityName,
      r.contact,
      r.invoiceNumber,
      r.reference,
      r.invoiceDate,
      r.dueDate,
      r.daysOverdue,
      r.bucket,
      r.currency,
      r.amountDue.toFixed(2),
      r.intercompany ? "yes" : "no",
    ]
      .map(csvCell)
      .join(",")
  );
  // BOM so Excel opens it as UTF-8 and supplier names with accents survive.
  const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const TH: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "var(--sub)",
  textAlign: "right",
  padding: "8px 10px",
  borderBottom: "1px solid var(--bd)",
  whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 12.5,
  color: "var(--tx)",
  textAlign: "right",
  padding: "8px 10px",
  borderBottom: "1px solid var(--bd)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
const LEFT: React.CSSProperties = { textAlign: "left", whiteSpace: "normal" };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: "var(--sub)",
        margin: "26px 0 8px",
      }}
    >
      {children}
    </div>
  );
}

function IcBadge() {
  return (
    <span
      style={{
        marginLeft: 6,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".05em",
        padding: "2px 5px",
        borderRadius: 3,
        border: "1px solid var(--warning-amber)",
        color: "var(--warning-amber)",
      }}
    >
      INTERCO
    </span>
  );
}

export default function AgedPayablesReport({
  report,
  slug,
  isGroupView,
}: {
  report: Report;
  slug: string;
  isGroupView: boolean;
}) {
  const [excludeIc, setExcludeIc] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const hasIc = report.invoices.some((i) => i.intercompany);
  const exclude = isGroupView && excludeIc;

  const invoices = useMemo(
    () => (exclude ? report.invoices.filter((i) => !i.intercompany) : report.invoices),
    [exclude, report.invoices]
  );
  const suppliers = useMemo(
    () => (exclude ? report.suppliers.filter((s) => !s.intercompany) : report.suppliers),
    [exclude, report.suppliers]
  );
  const currencies = Object.entries(report.currencies).sort(([a], [b]) =>
    a === "GBP" ? -1 : b === "GBP" ? 1 : a.localeCompare(b)
  );

  const failed = report.entities.filter((e) => e.status === "error");
  const notConnected = report.entities.filter((e) => e.status === "not_connected");
  const supplierKey = (s: AgedSupplierRow) => `${s.entity} ${s.contact} ${s.currency}`;

  return (
    <div>
      {!report.complete && (
        <div
          style={{
            padding: "12px 16px",
            border: "1px solid var(--alert-red)",
            borderRadius: 8,
            fontFamily: FONT,
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--tx)",
            marginBottom: 16,
          }}
        >
          <b style={{ color: "var(--alert-red)" }}>Incomplete.</b> These entities could not be read
          from Xero, so the totals below leave them out:{" "}
          {failed.map((e) => `${e.name} (${e.error ?? "error"})`).join("; ")}
        </div>
      )}
      {report.truncated && (
        <div style={{ fontFamily: FONT, fontSize: 13, color: "var(--alert-red)", marginBottom: 12 }}>
          More than 5,000 bills on at least one entity; only the first 5,000 were read.
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {isGroupView && hasIc && (
          <label
            style={{ fontFamily: FONT, fontSize: 12.5, color: "var(--tx)", display: "flex", gap: 6 }}
          >
            <input type="checkbox" checked={excludeIc} onChange={(e) => setExcludeIc(e.target.checked)} />
            Exclude intercompany
          </label>
        )}
        <button
          type="button"
          onClick={() =>
            downloadCsv(`aged-payables-${slug}-${report.scope}-${report.asAt}.csv`, invoices)
          }
          disabled={invoices.length === 0}
          style={{
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 700,
            padding: "7px 12px",
            borderRadius: 6,
            border: "1px solid #C5A059",
            background: "transparent",
            color: "var(--tx)",
            cursor: invoices.length ? "pointer" : "default",
          }}
        >
          Download CSV
        </button>
        {notConnected.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 11.5, color: "var(--sub)" }}>
            Not connected to Xero, not included: {notConnected.map((e) => e.name).join(", ")}
          </span>
        )}
      </div>

      <SectionTitle>Summary</SectionTitle>
      {currencies.length === 0 ? (
        <p style={{ fontFamily: FONT, fontSize: 13, color: "var(--sub)" }}>
          Nothing owed to suppliers.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...TH, ...LEFT }}>Currency</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} style={TH}>{b.label}</th>
                ))}
                <th style={TH}>Total</th>
                <th style={TH}>Bills</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map(([cur, c]) => {
                const shown = exclude ? minus(c.buckets, c.intercompany) : c.buckets;
                const showIcRow = isGroupView && !exclude && c.intercompany.total !== 0;
                return (
                  <Fragment key={cur}>
                    <tr>
                      <td style={{ ...TD, ...LEFT, fontWeight: 700 }}>{cur}</td>
                      {BUCKETS.map((b) => (
                        <td key={b.key} style={TD}>{money(shown[b.key])}</td>
                      ))}
                      <td style={{ ...TD, fontWeight: 700 }}>{money(shown.total)}</td>
                      <td style={TD}>
                        {exclude
                          ? invoices.filter((i) => i.currency === cur).length
                          : c.invoiceCount}
                      </td>
                    </tr>
                    {showIcRow && (
                      <tr>
                        <td style={{ ...TD, ...LEFT, color: "var(--sub)", fontSize: 11.5 }}>
                          of which intercompany
                        </td>
                        {BUCKETS.map((b) => (
                          <td key={b.key} style={{ ...TD, color: "var(--sub)", fontSize: 11.5 }}>
                            {money(c.intercompany[b.key])}
                          </td>
                        ))}
                        <td style={{ ...TD, color: "var(--sub)", fontSize: 11.5 }}>
                          {money(c.intercompany.total)}
                        </td>
                        <td style={TD} />
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {suppliers.length > 0 && (
        <>
          <SectionTitle>By supplier ({suppliers.length})</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, ...LEFT }}>Supplier</th>
                  {isGroupView && <th style={{ ...TH, ...LEFT }}>Entity</th>}
                  <th style={{ ...TH, ...LEFT }}>Cur</th>
                  {BUCKETS.map((b) => (
                    <th key={b.key} style={TH}>{b.label}</th>
                  ))}
                  <th style={TH}>Total</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => {
                  const key = supplierKey(s);
                  const isOpen = open === key;
                  const lines = isOpen
                    ? invoices.filter(
                        (i) => i.entity === s.entity && i.contact === s.contact && i.currency === s.currency
                      )
                    : [];
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => setOpen(isOpen ? null : key)}
                        style={{ cursor: "pointer" }}
                        title="Show bills"
                      >
                        <td style={{ ...TD, ...LEFT }}>
                          <span style={{ color: "var(--sub)", marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>
                          {s.contact}
                          {s.intercompany && <IcBadge />}
                          <span style={{ color: "var(--sub)", fontSize: 11, marginLeft: 6 }}>
                            ({s.invoiceCount})
                          </span>
                        </td>
                        {isGroupView && <td style={{ ...TD, ...LEFT, color: "var(--sub)" }}>{s.entityName}</td>}
                        <td style={{ ...TD, ...LEFT, color: "var(--sub)" }}>{s.currency}</td>
                        {BUCKETS.map((b) => (
                          <td key={b.key} style={TD}>{money(s.buckets[b.key])}</td>
                        ))}
                        <td style={{ ...TD, fontWeight: 700 }}>{money(s.total)}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={BUCKETS.length + (isGroupView ? 4 : 3)} style={{ padding: "4px 0 12px 26px", borderBottom: "1px solid var(--bd)" }}>
                            <table style={{ borderCollapse: "collapse", width: "100%" }}>
                              <thead>
                                <tr>
                                  <th style={{ ...TH, ...LEFT }}>Bill</th>
                                  <th style={{ ...TH, ...LEFT }}>Reference</th>
                                  <th style={TH}>Invoice date</th>
                                  <th style={TH}>Due date</th>
                                  <th style={TH}>Days overdue</th>
                                  <th style={TH}>Amount due</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((i, n) => (
                                  <tr key={i.invoiceId ?? `${i.invoiceNumber}-${n}`}>
                                    <td style={{ ...TD, ...LEFT }}>{i.invoiceNumber ?? "–"}</td>
                                    <td style={{ ...TD, ...LEFT, color: "var(--sub)" }}>{i.reference ?? ""}</td>
                                    <td style={TD}>{i.invoiceDate ?? "–"}</td>
                                    <td style={TD}>{i.dueDate ?? "–"}</td>
                                    <td
                                      style={{
                                        ...TD,
                                        color: i.daysOverdue > 60 ? "var(--alert-red)" : i.daysOverdue > 30 ? "var(--warning-amber)" : "var(--tx)",
                                      }}
                                    >
                                      {i.daysOverdue || "–"}
                                    </td>
                                    <td style={TD}>{money(i.amountDue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

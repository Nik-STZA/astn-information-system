// Words for the AP queue screen. Pure, so it is tested and safe on either side.

import type { ApState } from "./ap-queue";

export const AP_TABS: Array<{ key: string; label: string; states: ApState[] }> = [
  { key: "exceptions", label: "For you", states: ["exception"] },
  { key: "clean", label: "Clean", states: ["clean", "approved"] },
  { key: "sent", label: "Sent to Xero", states: ["written"] },
  { key: "set-aside", label: "Set aside", states: ["skipped", "rejected"] },
];

// Each check the engine runs, as the CFO would say it. The engine's own detail
// is shown under it.
const CHECKS: Record<string, string> = {
  not_evidence: "Not a purchase document",
  document_not_matched: "Bill does not match the document",
  pages_unread: "Some pages were not read",
  document_arithmetic: "The document's own totals do not add up",
  currency: "Currency differs from the document",
  total_vs_document: "Total differs from the document",
  vat_not_on_document: "VAT claimed that the document does not show",
  vat_not_claimed: "VAT on the document not claimed",
  vat_without_invoice: "VAT claimed without a VAT invoice",
  vat_treatment: "VAT treatment differs from the supplier's",
  date_vs_document: "Date differs from the document",
  date_in_future: "Dated in the future",
  addressee: "Not addressed to the company",
  customer_vat_number: "Another company's VAT number",
  line_incomplete: "A line has no account or VAT treatment",
  no_supplier: "Supplier not recognised",
  not_in_master: "New supplier",
  supplier_vat_number: "Supplier's VAT number has changed",
  cfo_review: "Supplier always comes to you",
  supplier_status: "Supplier is not active",
  duplicate: "May be a duplicate",
  reader_doubts: "The reader was unsure",
  no_due_date: "No due date",
  no_currency: "Currency not read",
  same_file_twice: "Same file on two bills",
};

export function checkLabel(check: string): string {
  return CHECKS[check] ?? check.replace(/_/g, " ");
}

const DOCUMENT_TYPES: Record<string, string> = {
  invoice: "Invoice",
  credit_note: "Credit note",
  receipt: "Receipt",
  payment_confirmation: "Payment confirmation",
  statement: "Statement",
  report_or_screenshot: "Report or screenshot",
  other: "Other",
};

export function documentTypeLabel(type: string | undefined | null): string {
  return type ? DOCUMENT_TYPES[type] ?? type : "Unknown";
}

// "GBP 1,234.50"; the currency is never assumed.
export function money(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "-";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "-";
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}

// "7 Oct 2026" from "2026-10-07" or "2026-10-07T00:00:00".
export function shortDate(value: string | null | undefined): string {
  if (!value) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

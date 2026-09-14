// CSV download and upload for the chart of accounts mapping. Pure functions, so
// the browser does the parsing and the server only ever receives validated
// account ids; finance-api still checks every change against Xero.

import type { CoaAccountRow, MappingChange, ReportingCategory } from "./coa";

export const CSV_HEADERS = ["code", "account", "class", "category", "category_label", "cash_flow", "status", "account_id"];

// RFC 4180: quoted fields, doubled quotes, commas and new lines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const cell = (v: string | null | undefined) => {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The current mapping, which is also the upload template.
export function mappingCsv(rows: CoaAccountRow[], categories: ReportingCategory[]): string {
  const labels = new Map(categories.map((c) => [c.key, c.label]));
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    const category = r.mapping?.category ?? r.proposal?.category ?? "";
    const status = r.mapping ? r.mapping.status : category ? "rule proposal" : "unmapped";
    lines.push(
      [r.code, r.name, r.class, category, labels.get(category) ?? "", r.mapping?.cashFlow ?? "", status, r.accountId]
        .map(cell)
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

// Matches an uploaded file to accounts and categories. Rows are matched by
// account_id when present, else by code; categories by key or label. Blank
// categories are skipped, so a partial file changes only what it names.
export function changesFromCsv(
  text: string,
  rows: CoaAccountRow[],
  categories: ReportingCategory[],
  { approve = false }: { approve?: boolean } = {}
): { changes: MappingChange[]; errors: string[]; skipped: number } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (!table.length) return { changes: [], errors: ["The file is empty"], skipped: 0 };
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => head.indexOf(name);
  const iId = col("account_id");
  const iCode = col("code");
  const iCat = col("category");
  const iFlow = col("cash_flow");
  if (iCat < 0 || (iId < 0 && iCode < 0)) {
    return { changes: [], errors: ["The file needs a category column and a code or account_id column"], skipped: 0 };
  }

  const byId = new Map(rows.map((r) => [r.accountId, r]));
  const byCode = new Map<string, CoaAccountRow[]>();
  for (const r of rows) {
    if (!r.code) continue;
    byCode.set(r.code.trim().toLowerCase(), [...(byCode.get(r.code.trim().toLowerCase()) ?? []), r]);
  }
  const catByKey = new Map(categories.map((c) => [c.key, c]));
  const catByLabel = new Map(categories.map((c) => [c.label.trim().toLowerCase(), c]));

  const changes: MappingChange[] = [];
  let skipped = 0;
  table.slice(1).forEach((line, i) => {
    const at = `Row ${i + 2}`;
    const rawCat = (line[iCat] ?? "").trim();
    if (!rawCat) {
      skipped++;
      return;
    }
    const id = iId >= 0 ? (line[iId] ?? "").trim() : "";
    const code = iCode >= 0 ? (line[iCode] ?? "").trim().toLowerCase() : "";
    let account: CoaAccountRow | undefined;
    if (id) account = byId.get(id);
    else if (code) {
      const found = byCode.get(code) ?? [];
      if (found.length > 1) return errors.push(`${at}: code ${code} is used by more than one account; add account_id`);
      account = found[0];
    }
    if (!account) return errors.push(`${at}: no account ${id || code || "(blank)"} in this entity`);

    const cat = catByKey.get(rawCat) ?? catByLabel.get(rawCat.toLowerCase());
    if (!cat) return errors.push(`${at}: unknown category "${rawCat}"`);

    const change: MappingChange = { accountId: account.accountId, category: cat.key, approve };
    if (iFlow >= 0) {
      const flow = (line[iFlow] ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      change.cashFlow = flow || null;
    }
    changes.push(change);
  });
  return { changes, errors, skipped };
}

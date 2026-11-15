"use client";

// Adding a contract (from what a PDF read proposed, or by hand) and editing
// one. Every term the read found shows the page it came from; a term the
// document normally has but this one does not give is marked. The person
// checks, fills the gaps and confirms. Finance terms only.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./Contracts.module.css";
import page from "./Page.module.css";
import type { Company, Contract, Pattern, Proposed, Renewal, Side } from "@/modules/finance/lib/contracts";

type Line = { kind: "payment" | "milestone"; label: string; trigger_text: string; amount: string; due_on: string; expected: string };

export default function ContractForm({
  slug, companies, patterns, proposed = null, uploadId = null, contract = null, fileName = null,
}: {
  slug: string;
  companies: Company[];
  patterns: Pattern[];
  proposed?: Proposed | null;
  uploadId?: string | null;
  contract?: Contract | null;
  fileName?: string | null;
}) {
  const router = useRouter();
  const editing = Boolean(contract);
  const start = contract ?? proposed;
  const [f, setF] = useState({
    side: (start?.side ?? "customer") as Side,
    entity: (contract?.entity_slug ?? proposed?.entity ?? (companies.length === 1 ? companies[0].slug : "")) as string,
    counterparty: start?.counterparty ?? "",
    title: start?.title ?? "",
    reference: start?.reference ?? "",
    pattern: start?.pattern ?? "",
    currency: start?.currency ?? "GBP",
    total_value: start?.total_value != null ? String(start.total_value) : "",
    start_date: start?.start_date ?? "",
    end_date: start?.end_date ?? "",
    renewal: (start?.renewal ?? "no") as Renewal,
    notice_days: start?.notice_days != null ? String(start.notice_days) : "",
    payment_terms: start?.payment_terms ?? "",
    account_code: contract?.account_code ?? "",
    notes: contract?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>((proposed?.schedule ?? []).map((s) => ({
    kind: s.kind, label: s.label, trigger_text: s.trigger_text ?? "", amount: s.amount != null ? String(s.amount) : "", due_on: s.due_on ?? "", expected: "",
  })));
  const [billed, setBilled] = useState({ on_date: "", amount: "", ref: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const here = `/finance/clients/${encodeURIComponent(slug)}/contracts`;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const page_ = (k: string) => (proposed?.pages?.[k] ? ` · ${proposed.pages[k]}` : "");
  const missing = new Set((proposed?.not_found ?? []).map((x) => x.toLowerCase()));
  const isMissing = (...words: string[]) => [...missing].some((m) => words.some((w) => m.includes(w)));
  const sidePatterns = patterns.filter((p) => p.side === f.side);
  const chosen = patterns.find((p) => p.key === f.pattern);

  async function submit() {
    setBusy(true);
    setIssues([]);
    const body: Record<string, unknown> = {
      side: f.side, entity: f.entity, counterparty: f.counterparty, title: f.title, reference: f.reference, pattern: f.pattern,
      currency: f.currency, total_value: f.total_value === "" ? null : f.total_value, start_date: f.start_date || null, end_date: f.end_date || null,
      renewal: f.renewal, notice_days: f.notice_days === "" ? null : Number(f.notice_days), payment_terms: f.payment_terms,
      account_code: f.account_code, notes: f.notes,
    };
    let url = `/api/finance/${encodeURIComponent(slug)}/contracts`;
    let method = "POST";
    if (editing && contract) {
      url += `/${contract.id}`;
      method = "PATCH";
    } else {
      body.schedule = lines.filter((l) => l.label.trim()).map((l) => ({
        kind: l.kind, label: l.label, trigger_text: l.trigger_text || null, amount: l.amount === "" ? null : l.amount,
        due_on: l.due_on || null, expected: l.expected || null,
      }));
      if (billed.amount) body.movements = [{ kind: "billed", on_date: billed.on_date, amount: billed.amount, ref: billed.ref || null }];
      if (uploadId) body.upload_id = uploadId;
      body.confirm_pattern = confirm;
    }
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setIssues(out.issues ?? [out.error ?? `Not saved (${r.status})`]); return; }
    router.push(`${here}/${editing && contract ? contract.id : out.id}`);
    router.refresh();
  }

  const line = (i: number, k: keyof Line) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setLines(lines.map((l, n) => (n === i ? { ...l, [k]: e.target.value } : l)));

  return (
    <div className={`${page.card} ${styles.section}`}>
      {proposed && (
        <div style={{ paddingTop: 12 }}>
          {proposed.is_contract === false && <div className={styles.issues}>This does not look like a contract. Add it only if it is one.</div>}
          <div className={styles.notice}>
            Read from {fileName ?? "the PDF"}. Check each term against the document, fill the gaps, then add it.
            {proposed.pattern_reason ? ` Pattern proposed because: ${proposed.pattern_reason}` : ""}
            {proposed.not_found.length > 0 ? ` Not found in the document: ${proposed.not_found.join(", ")}.` : ""}
          </div>
        </div>
      )}
      <div className={styles.form}>
        <label className={styles.field}>Side
          <select className={styles.select} value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as Side, pattern: "" })}>
            <option value="customer">Customer: the company sells</option>
            <option value="supplier">Supplier: the company buys</option>
          </select>
        </label>
        <label className={styles.field}>Company
          <select className={styles.select} value={f.entity} onChange={set("entity")}>
            <option value="">Choose the company</option>
            {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>With{page_("counterparty")}
          <input className={styles.input} value={f.counterparty} onChange={set("counterparty")} />
        </label>
        <label className={styles.field}>Title
          <input className={styles.input} value={f.title} onChange={set("title")} />
        </label>
        <label className={styles.field}>Reference (contract, quote or policy number)
          <input className={styles.input} value={f.reference} onChange={set("reference")} />
        </label>
        <label className={styles.field}>Pattern
          <select className={styles.select} value={f.pattern} onChange={set("pattern")}>
            <option value="">Choose how it becomes {f.side === "customer" ? "revenue" : "cost"}</option>
            {sidePatterns.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {chosen && <div className={`${styles.wide} ${styles.meta}`}>{chosen.rule} Evidence: {chosen.evidence}</div>}
        <label className={styles.field}>Currency
          <input className={styles.input} value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        </label>
        <label className={styles.field}>Total value{page_("total_value")}
          <input className={styles.input} inputMode="decimal" value={f.total_value} onChange={set("total_value")} />
        </label>
        <label className={`${styles.field} ${isMissing("start") ? styles.fieldMissing : ""}`}>Starts{page_("start_date")}
          <input className={styles.input} type="date" value={f.start_date} onChange={set("start_date")} />
        </label>
        <label className={`${styles.field} ${isMissing("end") ? styles.fieldMissing : ""}`}>Ends{page_("end_date")}
          <input className={styles.input} type="date" value={f.end_date} onChange={set("end_date")} />
        </label>
        <label className={styles.field}>Renewal{page_("renewal")}
          <select className={styles.select} value={f.renewal} onChange={set("renewal")}>
            <option value="no">Ends</option>
            <option value="auto">Renews itself unless notice is given</option>
            <option value="option">May be renewed</option>
          </select>
        </label>
        <label className={`${styles.field} ${isMissing("notice") ? styles.fieldMissing : ""}`}>Notice period, days{page_("notice_days")}{isMissing("notice") ? " · not found in the document" : ""}
          <input className={styles.input} inputMode="numeric" value={f.notice_days} onChange={set("notice_days")} />
        </label>
        <label className={styles.field}>Balance sheet account it holds money on (Xero code)
          <input className={styles.input} value={f.account_code} placeholder={f.side === "customer" ? "e.g. 810 deferred income" : "e.g. prepayments"} onChange={set("account_code")} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>Payment terms{page_("payment_terms")}
          <input className={styles.input} value={f.payment_terms} onChange={set("payment_terms")} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>Notes
          <textarea className={styles.textarea} value={f.notes} onChange={set("notes")} />
        </label>
      </div>

      {!editing && (
        <>
          <div className={styles.sectionHead} style={{ padding: "0 16px" }}><h2>Payments and milestones</h2></div>
          <div className={styles.lines}>
            {lines.map((l, i) => (
              <div key={i} className={styles.line}>
                <label className={styles.field}>Kind
                  <select className={styles.select} value={l.kind} onChange={line(i, "kind")}>
                    <option value="payment">Payment</option>
                    <option value="milestone">Milestone</option>
                  </select>
                </label>
                <label className={styles.field}>Label<input className={styles.input} value={l.label} onChange={line(i, "label")} /></label>
                <label className={styles.field}>Due when (as the contract says)<input className={styles.input} value={l.trigger_text} onChange={line(i, "trigger_text")} /></label>
                <label className={styles.field}>Amount<input className={styles.input} inputMode="decimal" value={l.amount} onChange={line(i, "amount")} /></label>
                <label className={styles.field}>Date, if known<input className={styles.input} type="date" value={l.due_on} onChange={line(i, "due_on")} /></label>
                <label className={styles.field}>Or expected<input className={styles.input} value={l.expected} placeholder="e.g. early 2027" onChange={line(i, "expected")} /></label>
                <div><button type="button" className={styles.btn} onClick={() => setLines(lines.filter((_, n) => n !== i))}>Remove</button></div>
              </div>
            ))}
            <div>
              <button type="button" className={styles.btn} onClick={() => setLines([...lines, { kind: "payment", label: "", trigger_text: "", amount: "", due_on: "", expected: "" }])}>Add a payment or milestone</button>
            </div>
          </div>

          {f.side === "customer" && (
            <>
              <div className={styles.sectionHead} style={{ padding: "0 16px" }}><h2>Already billed into the account</h2></div>
              <div className={styles.form}>
                <label className={styles.field}>Invoice date<input className={styles.input} type="date" value={billed.on_date} onChange={(e) => setBilled({ ...billed, on_date: e.target.value })} /></label>
                <label className={styles.field}>Amount held<input className={styles.input} inputMode="decimal" value={billed.amount} onChange={(e) => setBilled({ ...billed, amount: e.target.value })} /></label>
                <label className={styles.field}>Invoice number<input className={styles.input} value={billed.ref} onChange={(e) => setBilled({ ...billed, ref: e.target.value })} /></label>
              </div>
            </>
          )}

          <label className={styles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: "0 16px 12px", color: "var(--tx)", fontSize: 13 }}>
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            Confirm the pattern now (CFO)
          </label>
        </>
      )}

      {issues.length > 0 && (
        <div className={styles.issues} role="alert">Not saved:<ul>{issues.map((x) => <li key={x}>{x}</li>)}</ul></div>
      )}
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={submit}>
          {busy ? "Saving..." : editing ? "Save changes" : proposed ? "Confirm and add" : "Add contract"}
        </button>
        <Link prefetch={false} className={styles.btn} href={editing && contract ? `${here}/${contract.id}` : here}>Cancel</Link>
      </div>
    </div>
  );
}

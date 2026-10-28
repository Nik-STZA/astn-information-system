"use client";

// Chart of accounts mapping for one client: a category per Xero account, per
// entity, saved and approved here; the client's reporting categories; and a CSV
// download and upload. On a phone the account table scrolls inside its own card.

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  CategoryMeta,
  CoaAccountRow,
  CoaMappingView,
  MappingChange,
  ReportingCategory,
} from "@/modules/finance/lib/coa";
import { changesFromCsv, mappingCsv } from "@/modules/finance/lib/coa-csv";
import { Download, Upload } from "lucide-react";
import styles from "./Page.module.css";

const SECTION_LABELS: Record<string, string> = {
  turnover: "Turnover",
  cost_of_sales: "Cost of sales",
  overheads: "Overheads",
  finance: "Finance income and costs",
  taxation: "Taxation",
  fixed_assets: "Fixed assets",
  current_assets: "Current assets",
  creditors_lt1y: "Creditors within one year",
  creditors_gt1y: "Creditors after one year",
  provisions: "Provisions",
  equity: "Capital and reserves",
};

const FLAG_LABELS: Record<string, string> = {
  renamed_in_xero: "Code or name changed in Xero since it was saved",
  unknown_category: "Saved category no longer exists",
  category_switched_off: "Saved category is switched off",
  wrong_statement: "Saved category is on the wrong statement",
};

const flowLabel = (f: string | null | undefined) => (f ? f.replace(/_/g, " ") : "none");

const dateLabel = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const input: CSSProperties = { height: 30, fontSize: 13 };
const th: CSSProperties = {
  textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--sub)",
  padding: "10px 10px", borderBottom: "1px solid var(--bd)", whiteSpace: "nowrap",
};
const td: CSSProperties = { fontSize: 13, padding: "8px 10px", borderBottom: "1px solid var(--bd)", verticalAlign: "top", color: "var(--tx)" };
const note: CSSProperties = { fontSize: 11, color: "var(--sub)", marginTop: 2 };

type Edit = { category?: string; cashFlow?: string | null };
type Filter = "attention" | "all" | "approved";
type Message = { kind: "ok" | "error"; text: string; errors?: string[] };

export default function CoaMappingPanel({
  slug,
  initialView,
  initialMeta,
}: {
  slug: string;
  initialView: CoaMappingView;
  initialMeta: CategoryMeta;
}) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [meta, setMeta] = useState(initialMeta);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("attention");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [upload, setUpload] = useState<{ name: string; text: string } | null>(null);
  const [approveOnUpload, setApproveOnUpload] = useState(false);

  const entity = view.entity?.slug ?? "";
  const categories = useMemo(() => new Map(meta.data.map((c) => [c.key, c])), [meta]);

  const categoryOf = (r: CoaAccountRow) =>
    edits[r.accountId]?.category ?? r.mapping?.category ?? r.proposal?.category ?? "";
  const flowOf = (r: CoaAccountRow) =>
    edits[r.accountId] && "cashFlow" in edits[r.accountId] ? edits[r.accountId].cashFlow ?? null : r.mapping?.cashFlow ?? null;
  const isEdited = (r: CoaAccountRow) => Boolean(edits[r.accountId]);
  const approved = (r: CoaAccountRow) => r.mapping?.status === "approved" && !r.flags.length && !isEdited(r);

  const counts = useMemo(() => {
    const c = { approved: 0, saved: 0, suggestion: 0, none: 0, flagged: 0 };
    for (const r of view.rows) {
      if (r.flags.length) c.flagged++;
      if (r.mapping?.status === "approved") c.approved++;
      else if (r.mapping) c.saved++;
      else if (r.proposal?.category) c.suggestion++;
      else c.none++;
    }
    return c;
  }, [view.rows]);

  const shown = view.rows.filter((r) => {
    if (filter === "attention" && approved(r)) return false;
    if (filter === "approved" && !approved(r)) return false;
    const q = search.trim().toLowerCase();
    return !q || `${r.code ?? ""} ${r.name} ${r.reportingCode ?? ""}`.toLowerCase().includes(q);
  });

  async function reload() {
    const [v, m] = await Promise.all([
      fetch(`/api/finance/${encodeURIComponent(slug)}/coa-mapping?entity=${encodeURIComponent(entity)}`),
      fetch(`/api/finance/${encodeURIComponent(slug)}/reporting-categories`),
    ]);
    if (v.ok) setView(await v.json());
    if (m.ok) setMeta(await m.json());
    setEdits({});
    setSelected(new Set());
  }

  async function send(changes: MappingChange[], source: "manual" | "upload" | "rule", note?: string) {
    if (!changes.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/coa-mapping/${encodeURIComponent(entity)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes, source, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: body.error ?? "Nothing was saved", errors: body.errors });
        return;
      }
      setMessage({
        kind: "ok",
        text: `Saved ${body.saved} account${body.saved === 1 ? "" : "s"}` +
          (body.approved ? `, ${body.approved} approved` : "") +
          (body.unchanged ? `; ${body.unchanged} already as sent` : "") + ".",
      });
      setUpload(null);
      await reload();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the portal API" });
    } finally {
      setBusy(false);
    }
  }

  // The category is sent only when it was changed here: otherwise finance-api
  // keeps what is saved, or takes the suggestion with its reason.
  const changeFor = (r: CoaAccountRow, approve: boolean): MappingChange => {
    const e = edits[r.accountId];
    return {
      accountId: r.accountId,
      ...(e?.category ? { category: e.category } : {}),
      ...(e && "cashFlow" in e ? { cashFlow: e.cashFlow ?? null } : {}),
      approve,
    };
  };

  const editedRows = view.rows.filter(isEdited);
  const selectedRows = view.rows.filter((r) => selected.has(r.accountId));
  const approvable = view.rows.filter((r) => !approved(r) && categoryOf(r));

  function setEdit(r: CoaAccountRow, patch: Edit) {
    setEdits((prev) => ({ ...prev, [r.accountId]: { ...prev[r.accountId], ...patch } }));
  }

  function download() {
    const blob = new Blob([mappingCsv(view.rows, meta.data)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}-${entity}-account-mapping.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const uploadPlan = upload
    ? changesFromCsv(upload.text, view.rows, meta.data, { approve: approveOnUpload })
    : null;

  return (
    <div>
      {/* Company and summary */}
      <div className={styles.controls} style={{ marginBottom: 10 }}>
        <div className="seg" role="radiogroup" aria-label="Company">
          {view.entities.map((e) => (
            <button
              key={e.slug}
              type="button"
              role="radio"
              aria-checked={e.slug === entity}
              className={e.slug === entity ? "seg-on" : undefined}
              title={e.connected ? e.name : `${e.name} (not connected)`}
              onClick={() => router.push(`/finance/clients/${slug}/coa?entity=${encodeURIComponent(e.slug)}`)}
            >
              {e.name}{e.connected ? "" : " (not connected)"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.controls} style={{ gap: 6, marginBottom: 12 }}>
        <span className={styles.small}>{view.rows.length} accounts:</span>
        <span className={`${styles.status} ${styles[counts.approved ? "s-green" : "s-neutral"]}`}>{counts.approved} approved</span>
        {counts.saved > 0 && <span className={`${styles.status} ${styles["s-amber"]}`}>{counts.saved} saved, not approved</span>}
        {counts.suggestion > 0 && <span className={`${styles.status} ${styles["s-neutral"]}`}>{counts.suggestion} suggestion only</span>}
        {counts.none > 0 && <span className={`${styles.status} ${styles["s-red"]}`}>{counts.none} no suggestion</span>}
        {counts.flagged > 0 && <span className={`${styles.status} ${styles["s-amber"]}`}>{counts.flagged} to check</span>}
      </div>

      {view.xeroError && (
        <div className={styles.error} role="alert" style={{ marginBottom: 12 }}>
          Xero could not be read, so this shows saved mappings only and nothing can be saved: {view.xeroError}
        </div>
      )}

      {/* Actions */}
      <div className={`${styles.card} ${styles.pad} ${styles.stack}`} style={{ marginBottom: 12, maxWidth: 1100 }}>
        <div className={styles.controls} style={{ gap: 8 }}>
          <button type="button" className="btn-primary" disabled={busy || !approvable.length || Boolean(view.xeroError)}
            onClick={() => send(approvable.map((r) => changeFor(r, true)), "manual")}>
            Approve all unapproved ({approvable.length})
          </button>
          <button type="button" className="btn-secondary" disabled={busy || !selectedRows.length}
            onClick={() => send(selectedRows.filter(categoryOf).map((r) => changeFor(r, true)), "manual")}>
            Approve selected ({selectedRows.length})
          </button>
          <button type="button" className="btn-secondary" disabled={busy || !editedRows.length}
            onClick={() => send(editedRows.map((r) => changeFor(r, false)), "manual")}>
            Save without approving ({editedRows.length})
          </button>
          {editedRows.length > 0 && (
            <button type="button" className="btn-text" disabled={busy} onClick={() => setEdits({})}>Discard changes</button>
          )}
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn-secondary" onClick={download} disabled={!view.rows.length}>
              <Download size={15} aria-hidden="true" />Download CSV
            </button>
            <label className="btn-secondary" style={{ cursor: "pointer" }}>
              <Upload size={15} aria-hidden="true" />Upload CSV
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setUpload({ name: f.name, text: await f.text() });
                }}
              />
            </label>
          </div>
        </div>
        <div className={styles.small}>
          &quot;Approve all unapproved&quot; approves the category showing in each of those rows, whether
          it is saved, a suggestion, or your unsaved change. Changing an approved account&apos;s category needs approving again. The
          CSV download is also the upload template: fill the category column with a category key or label; rows with
          a blank category are left alone.
        </div>
      </div>

      {upload && uploadPlan && (
        <div className={`${styles.card} ${styles.pad} ${styles.stack}`} style={{ marginBottom: 12, maxWidth: 1100 }}>
          <div className={styles.rowTitle} style={{ fontSize: 14, overflowWrap: "anywhere" }}>Upload: {upload.name}</div>
          <div style={{ fontSize: 13 }}>
            {uploadPlan.changes.length} account{uploadPlan.changes.length === 1 ? "" : "s"} to update
            {uploadPlan.skipped ? `, ${uploadPlan.skipped} row(s) with no category skipped` : ""}
            {uploadPlan.errors.length ? `, ${uploadPlan.errors.length} problem(s)` : ""}.
          </div>
          {uploadPlan.errors.length > 0 && (
            <ul className={styles.warn} style={{ margin: "0 0 0 18px", padding: 0 }}>
              {uploadPlan.errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          <div className={styles.controls}>
            <label style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={approveOnUpload} onChange={(e) => setApproveOnUpload(e.target.checked)} />
              Approve on upload
            </label>
            <button type="button" className="btn-primary"
              disabled={busy || Boolean(uploadPlan.errors.length) || !uploadPlan.changes.length || Boolean(view.xeroError)}
              onClick={() => send(uploadPlan.changes, "upload", upload.name)}>
              Apply upload
            </button>
            <button type="button" className="btn-secondary" onClick={() => setUpload(null)}>Cancel</button>
          </div>
        </div>
      )}

      {message && (
        <div className={message.kind === "ok" ? styles.ok : styles.error} role={message.kind === "ok" ? "status" : "alert"} style={{ marginBottom: 12 }}>
          {message.text}
          {message.errors && (
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {message.errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Filter */}
      <div className={styles.controls} style={{ marginBottom: 10 }}>
        <div className="seg" role="radiogroup" aria-label="Show">
          {(["attention", "all", "approved"] as Filter[]).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f}
              className={filter === f ? "seg-on" : undefined} onClick={() => setFilter(f)}>
              {f === "attention" ? "Needs attention" : f === "all" ? "All accounts" : "Approved"}
            </button>
          ))}
        </div>
        <input placeholder="Search code, name or reporting code" aria-label="Search accounts" value={search}
          onChange={(e) => setSearch(e.target.value)} className={styles.select} style={{ flex: "1 1 220px", maxWidth: 340 }} />
        <span className={styles.small}>{shown.length} shown</span>
      </div>

      <div className={styles.card} style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={th}>
                <input type="checkbox" aria-label="Select all shown"
                  checked={shown.length > 0 && shown.every((r) => selected.has(r.accountId))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r.accountId)) : new Set())} />
              </th>
              <th style={th}>Code</th>
              <th style={th}>Account</th>
              <th style={th}>Xero type</th>
              <th style={th}>Category</th>
              <th style={th}>Cash flow</th>
              <th style={th}>Status</th>
              <th style={th}>Why</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const cat = categoryOf(r);
              const options = meta.data.filter((c) => c.statement === r.statement && (c.active || c.key === cat));
              const catInfo = categories.get(cat);
              return (
                <tr key={r.accountId} style={{ background: isEdited(r) ? "var(--accent-bg)" : undefined }}>
                  <td style={td}>
                    <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.accountId)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(r.accountId);
                        else next.delete(r.accountId);
                        setSelected(next);
                      }} />
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.code ?? ""}</td>
                  <td style={td}>
                    {r.name}
                    {r.xeroStatus !== "ACTIVE" && <span style={{ color: "var(--sub)" }}> ({r.xeroStatus.toLowerCase()})</span>}
                  </td>
                  <td style={{ ...td, color: "var(--sub)", whiteSpace: "nowrap" }}>
                    {r.class} / {r.type}
                    {r.reportingCode ? <div style={note}>{r.reportingCode}</div> : null}
                  </td>
                  <td style={td}>
                    <select value={cat} className={styles.select} style={{ ...input, maxWidth: 260 }}
                      onChange={(e) => setEdit(r, { category: e.target.value })}>
                      {!cat && <option value="">Choose a category</option>}
                      {options.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}{c.active ? "" : " (switched off)"}
                        </option>
                      ))}
                    </select>
                    {!r.mapping && r.proposal?.category && !isEdited(r) && (
                      <div style={note}>Suggestion</div>
                    )}
                  </td>
                  <td style={td}>
                    {r.statement === "bs" ? (
                      <select value={flowOf(r) ?? ""} className={styles.select} style={input}
                        onChange={(e) => setEdit(r, { cashFlow: e.target.value || null })}>
                        <option value="">Category default ({flowLabel(catInfo?.cashFlow)})</option>
                        {view.cashFlows.account.map((f) => <option key={f} value={f}>{flowLabel(f)}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: "var(--sub)" }}>{catInfo?.cashFlow === "non_cash" ? "added back" : ""}</span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <Status row={r} edited={isEdited(r)} />
                  </td>
                  <td style={{ ...td, fontSize: 12, color: "var(--sub)", maxWidth: 280 }}>
                    {r.mapping?.reason ?? r.proposal?.reason ?? ""}
                    {r.flags.map((f) => (
                      <div key={f} className={styles.warn} style={{ fontSize: 12 }}>
                        {FLAG_LABELS[f] ?? f}
                        {f === "renamed_in_xero" && r.mapping ? ` (saved as ${r.mapping.savedCode ?? ""} ${r.mapping.savedName})` : ""}
                      </div>
                    ))}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {!approved(r) && (
                      <button type="button" className={styles.miniBtn} disabled={busy || !cat || Boolean(view.xeroError)}
                        onClick={() => send([changeFor(r, true)], "manual")}>
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td style={{ ...td, color: "var(--sub)", padding: 16 }} colSpan={9}>
                  {filter === "attention" ? "Nothing needs attention: every account is approved." : "No accounts match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {view.orphans.length > 0 && (
        <>
          <div className={styles.listHead}><h2>Saved for accounts no longer in Xero</h2></div>
          <div className={styles.small} style={{ maxWidth: 980 }}>
            {view.orphans.map((o) => `${o.code ?? ""} ${o.name} (${o.category}, ${o.status})`).join("; ")}
          </div>
        </>
      )}

      <Categories slug={slug} meta={meta} busy={busy} setBusy={setBusy} onChanged={reload} setMessage={setMessage} />
    </div>
  );
}

function Status({ row, edited }: { row: CoaAccountRow; edited: boolean }) {
  const pill = (tone: string, label: string) => (
    <span className={`${styles.status} ${styles[tone]}`}><span className={styles.dot} />{label}</span>
  );
  if (edited) return pill("s-amber", "Unsaved change");
  const m = row.mapping;
  if (m?.status === "approved") {
    return (
      <div title={`${m.approvedBy ?? ""} ${dateLabel(m.approvedAt)}`}>
        {pill("s-green", "Approved")}
        <div style={note}>{m.approvedBy?.split("@")[0]} {dateLabel(m.approvedAt)}</div>
      </div>
    );
  }
  if (m) return pill("s-amber", "Saved, not approved");
  if (row.proposal?.category) return pill("s-neutral", "Not saved");
  return pill("s-red", "No category");
}

// ── Reporting categories ──────────────────────────────────────────────────────

type Draft = { key: string; label: string; statement: "pnl" | "bs"; section: string; sortOrder: string; cashFlow: string; active: boolean };

const draftOf = (c: ReportingCategory): Draft => ({
  key: c.key, label: c.label, statement: c.statement, section: c.section,
  sortOrder: String(c.sortOrder), cashFlow: c.cashFlow ?? "", active: c.active,
});

function Categories({
  slug, meta, busy, setBusy, onChanged, setMessage,
}: {
  slug: string;
  meta: CategoryMeta;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => Promise<void>;
  setMessage: (m: Message | null) => void;
}) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [adding, setAdding] = useState(false);

  async function call(method: "PUT" | "DELETE", key: string, body?: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/reporting-categories/${encodeURIComponent(key)}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: out.error ?? "Could not save the category", errors: out.errors });
        return false;
      }
      setMessage({ kind: "ok", text: method === "DELETE" ? (out.reset ? `${key} is back to the standard line.` : `${key} removed.`) : `Saved ${key}.` });
      await onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function save(d: Draft) {
    const ok = await call("PUT", d.key, {
      label: d.label, statement: d.statement, section: d.section, sortOrder: Number(d.sortOrder),
      cashFlow: d.cashFlow || null, active: d.active,
    });
    if (ok) {
      setEditing(null);
      setAdding(false);
    }
  }

  const form = (d: Draft, isNew: boolean) => {
    const set = (patch: Partial<Draft>) => setEditing({ ...d, ...patch });
    const sections = d.statement === "pnl" ? meta.sections.pnl : meta.sections.bs;
    const flows = d.statement === "pnl" ? ["", "non_cash"] : meta.cashFlows.category;
    return (
      <tr style={{ background: "var(--accent-bg)" }}>
        <td style={td}>
          <input className={styles.select} style={{ ...input, width: 64 }} value={d.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
        </td>
        <td style={td}>
          <input className={styles.select} style={{ ...input, width: 240 }} value={d.label} placeholder="Label"
            onChange={(e) => set({ label: e.target.value, ...(isNew ? { key: slugKey(e.target.value) } : {}) })} />
          <div style={note}>Key {d.key || "(from the label)"}</div>
        </td>
        <td style={td}>
          {isNew ? (
            <select className={styles.select} style={input} value={d.statement}
              onChange={(e) => {
                const statement = e.target.value as "pnl" | "bs";
                set({ statement, section: (statement === "pnl" ? meta.sections.pnl : meta.sections.bs)[0], cashFlow: statement === "pnl" ? "" : "working_capital" });
              }}>
              <option value="pnl">Profit and loss</option>
              <option value="bs">Balance sheet</option>
            </select>
          ) : d.statement === "pnl" ? "Profit and loss" : "Balance sheet"}
        </td>
        <td style={td}>
          <select className={styles.select} style={input} value={d.section} onChange={(e) => set({ section: e.target.value })}>
            {sections.map((s) => <option key={s} value={s}>{SECTION_LABELS[s] ?? s}</option>)}
          </select>
        </td>
        <td style={td}>
          <select className={styles.select} style={input} value={d.cashFlow} onChange={(e) => set({ cashFlow: e.target.value })}>
            {flows.map((f) => <option key={f} value={f}>{f ? flowLabel(f) : "none"}</option>)}
          </select>
        </td>
        <td style={td}>
          <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} />
        </td>
        <td style={td} colSpan={2}>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className={`${styles.miniBtn} ${styles.miniPrimary}`} disabled={busy || !d.key || !d.label} onClick={() => save(d)}>Save</button>
            <button type="button" className={styles.miniBtn} onClick={() => { setEditing(null); setAdding(false); }}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <details style={{ marginTop: 24 }}>
      <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--tx)", cursor: "pointer" }}>Reporting categories ({meta.data.length})</summary>
      <div className={styles.small} style={{ margin: "8px 0 10px", maxWidth: 900 }}>
        The lines the management pack shows. The standard set applies to every client; changing one here changes it
        for this client only, and a category added here exists for this client only (for example a separate
        amortisation line for a business that capitalises development). Section decides where the line sits on the
        statement. Cash flow decides where a balance sheet line&apos;s movement goes on the cash flow; on the profit and
        loss, non cash lines are added back.
      </div>
      <div className={styles.card} style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              {["Order", "Label", "Statement", "Section", "Cash flow", "In use", "Scope", ""].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meta.data.map((c) =>
              editing && !adding && editing.key === c.key ? (
                <FormRow key={c.key}>{form(editing, false)}</FormRow>
              ) : (
                <tr key={c.key} style={{ opacity: c.active ? 1 : 0.55 }}>
                  <td style={td}>{c.sortOrder}</td>
                  <td style={td}>
                    {c.label}
                    <div style={note}>{c.key}{c.active ? "" : ", switched off"}</div>
                  </td>
                  <td style={td}>{c.statement === "pnl" ? "Profit and loss" : "Balance sheet"}</td>
                  <td style={td}>{SECTION_LABELS[c.section] ?? c.section}</td>
                  <td style={td}>{flowLabel(c.cashFlow)}</td>
                  <td style={td}>{c.accounts ?? 0}</td>
                  <td style={td}>{c.scope === "standard" ? "Standard" : c.scope === "override" ? "Changed for this client" : "This client only"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className={styles.miniBtn} disabled={busy} onClick={() => { setAdding(false); setEditing(draftOf(c)); }}>Edit</button>
                    {c.scope !== "standard" && (
                      <button type="button" className={styles.miniBtn} disabled={busy} onClick={() => call("DELETE", c.key)}>
                        {c.scope === "override" ? "Reset to standard" : "Remove"}
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              )
            )}
            {adding && editing && <FormRow>{form(editing, true)}</FormRow>}
          </tbody>
        </table>
      </div>
      {!adding && (
        <button type="button" className="btn-secondary" style={{ marginTop: 10 }} disabled={busy}
          onClick={() => {
            setAdding(true);
            setEditing({ key: "", label: "", statement: "pnl", section: "overheads", sortOrder: "65", cashFlow: "", active: true });
          }}>
          Add a category for this client
        </button>
      )}
    </details>
  );
}

function FormRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function slugKey(label: string) {
  const k = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return /^[a-z]/.test(k) ? k : k ? `c_${k}`.slice(0, 48) : "";
}

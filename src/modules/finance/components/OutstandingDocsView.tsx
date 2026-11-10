"use client";

// Outstanding documents (Nik, 10 Nov 2026). Drop a batch of reports (bank
// reconciliation reports, a former accountant's query list) onto the page;
// each is uploaded, then read into lines to accept. Accepted lines sit on the
// register, by month, until the document comes or the CFO closes them without
// one. Nothing here blocks a sign-off.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Download, FileUp, RefreshCw, SearchCheck, UserSearch } from "lucide-react";
import {
  ACCEPT, CONCERN_ORDER, NO_HOLDER, amountText, byMonth, byUpload, checkMonths, dateText, fileProblem, filtered, holders, inBatches, monthLabel, pounds, xeroLabel,
  type Concern, type DocItem, type DocList, type DocUpload, type Filters,
} from "@/modules/finance/lib/outstanding-docs";
import page from "./Page.module.css";
import styles from "./OutstandingDocs.module.css";

type View = "open" | "accept" | "closed";
type Company = { slug: string; name: string };
type Reply = { ok: boolean; status: number; body: Record<string, unknown> };

const said = (b: Record<string, unknown>, fallback: string) =>
  String((b.issues as string[] | undefined)?.join(" ") ?? b.error ?? fallback);

export default function OutstandingDocsView({ slug, data, companies, view }: {
  slug: string; data: DocList; companies: Company[]; view: View;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/finance/clients/${encodeURIComponent(slug)}/outstanding-documents`;

  const call = async (method: "POST" | "PATCH", path: string, body: unknown = {}): Promise<Reply> => {
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/outstanding-documents${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  };
  // A step from a button: the error beside the page head, then a refresh.
  const act = async (method: "POST" | "PATCH", path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    const r = await call(method, path, body);
    setBusy(false);
    if (!r.ok) setError(said(r.body, "That did not work"));
    router.refresh();
    return r;
  };

  if (data.migration_missing) {
    return <div className={page.error} role="status">Outstanding documents are built but not switched on: migration 040 has not been applied to the database yet.</div>;
  }

  const s = data.summary;
  const candidates = data.items.filter((i) => i.state === "candidate");
  const open = data.items.filter((i) => i.state === "open");
  const closed = data.items.filter((i) => ["received", "accepted", "dismissed"].includes(i.state));

  return (
    <div>
      <Tiles data={data} act={act} />
      <Uploader slug={slug} onDone={() => router.refresh()} />
      <Files uploads={data.uploads} act={act} busy={busy} />

      <div className={`seg ${styles.section}`} role="group" aria-label="Show" style={{ display: "inline-flex" }}>
        <Link prefetch={false} href={base} className={view === "open" ? "seg-on" : undefined}>On the register ({s.open.count})</Link>
        <Link prefetch={false} href={`${base}?view=accept`} className={view === "accept" ? "seg-on" : undefined}>To accept ({s.candidates})</Link>
        <Link prefetch={false} href={`${base}?view=closed`} className={view === "closed" ? "seg-on" : undefined}>Closed</Link>
      </div>
      <Toolbar slug={slug} data={data} act={act} busy={busy} />
      {error && <div className={page.error} role="alert" style={{ marginTop: 10 }}>{error}</div>}

      {view === "accept" && <ToAccept items={candidates} uploads={data.uploads} companies={companies} data={data} act={act} call={call} busy={busy} />}
      {view === "open" && <Register items={open} companies={companies} data={data} act={act} busy={busy} />}
      {view === "closed" && <Closed items={closed} data={data} act={act} busy={busy} />}
    </div>
  );
}

// ── Excel and card holders ───────────────────────────────────────────────────

function Toolbar({ slug, data, act, busy }: { slug: string; data: DocList; act: (m: "POST", p: string, b?: unknown) => Promise<Reply>; busy: boolean }) {
  const [result, setResult] = useState<string | null>(null);
  const months = checkMonths();
  const [month, setMonth] = useState(months[0].value);
  const missing = data.items.filter((i) => (i.state === "open" || i.state === "candidate") && !i.card_holder).length;
  const check = async () => {
    setResult("Checking Xero...");
    const r = await act("POST", "/xero-check", { month });
    if (!r.ok) { setResult(null); return; }
    const parts = ((r.body.companies as Array<{ name: string; cleared: unknown[]; added: number; matched: number; error: string | null }>) ?? [])
      .map((c) => c.error ? `${c.name}: Xero could not be read (${c.error})` : `${c.name}: ${c.cleared.length} cleared, ${c.added} added for you to accept`);
    setResult(`${monthLabel(month)}. ${parts.join("; ")}.`);
  };
  const href = (scope: string) => `/api/finance/${encodeURIComponent(slug)}/outstanding-documents/export.xlsx?scope=${scope}`;
  return (
    <div className={page.controls} style={{ marginTop: 12 }}>
      <a className="btn-secondary" href={href("open")} download><Download size={14} style={{ marginRight: 6 }} />Excel: open items</a>
      <a className="btn-text" href={href("all")} download>Excel with closed items</a>
      <span className={page.controls} style={{ gap: 6 }}>
        <select className={page.select} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month to check">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void check()}
          title="Clears open items whose document is now attached in Xero, and adds the month's spend money and bills with no attachment for you to accept">
          <SearchCheck size={14} style={{ marginRight: 6 }} />Check Xero
        </button>
      </span>
      {missing > 0 && (
        <button type="button" className="btn-text" disabled={busy}
          title="Reads each line's payee and reference for the person who made the payment. Never changes one already set."
          onClick={async () => { setResult(null); const r = await act("POST", "/card-holders"); if (r.ok) setResult(`Card holder found for ${r.body.found} of ${r.body.asked}.`); }}>
          <UserSearch size={14} style={{ marginRight: 6 }} />Find card holders ({missing})
        </button>
      )}
      {result && <span className={page.small} role="status">{result}</span>}
    </div>
  );
}

// ── Figures ──────────────────────────────────────────────────────────────────

function Tiles({ data, act }: { data: DocList; act: (m: "PATCH", p: string, b: unknown) => Promise<Reply> }) {
  const s = data.summary;
  const [editing, setEditing] = useState(false);
  const [threshold, setThreshold] = useState(String(data.threshold));
  return (
    <div className={styles.tiles}>
      <div className={`${page.card} ${styles.tile}`}>
        <div className={styles.tileLabel}>On the register</div>
        <div className={styles.tileValue}>{s.open.count.toLocaleString("en-GB")} · {pounds(s.open.value)}</div>
        {s.open.unknown_gbp > 0 && <div className={styles.tileSub}>{s.open.unknown_gbp} in another currency with no sterling value</div>}
      </div>
      <div className={`${page.card} ${styles.tile}`}>
        <div className={styles.tileLabel}>VAT not recoverable</div>
        <div className={styles.tileValue}>{s.vat.flagged.toLocaleString("en-GB")} · up to {pounds(s.vat.at_risk_max)}</div>
        {!editing ? (
          <div className={styles.tileSub}>
            Costs above {pounds(data.threshold)} with no VAT invoice.{" "}
            <button type="button" className="btn-text" style={{ fontSize: 12 }} onClick={() => setEditing(true)}>Change</button>
          </div>
        ) : (
          <form className={styles.edit} onSubmit={async (e) => { e.preventDefault(); const r = await act("PATCH", "/settings", { vat_threshold: threshold }); if (r.ok) setEditing(false); }}>
            <input className={styles.input} style={{ width: 90 }} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="VAT threshold" />
            <button type="submit" className={page.miniBtn}>Save</button>
            <button type="button" className={page.miniBtn} onClick={() => setEditing(false)}>Cancel</button>
          </form>
        )}
      </div>
      <div className={`${page.card} ${styles.tile}`}>
        <div className={styles.tileLabel}>Oldest open</div>
        <div className={styles.tileValue}>{s.oldest ? monthLabel(s.oldest.slice(0, 7)) : "-"}</div>
        <div className={styles.tileSub}>Carried in the close; never blocks a sign-off</div>
      </div>
      <div className={`${page.card} ${styles.tile}`}>
        <div className={styles.tileLabel}>Read, waiting to accept</div>
        <div className={styles.tileValue}>{s.candidates.toLocaleString("en-GB")}</div>
      </div>
    </div>
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────

type Progress = { key: string; name: string; status: "waiting" | "uploading" | "reading" | "done" | "failed" | "skipped"; text: string; uploadId?: string };

function Uploader({ slug, onDone }: { slug: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState<Progress[]>([]);
  const [running, setRunning] = useState(false);

  const set = (key: string, patch: Partial<Progress>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function read(key: string, uploadId: string) {
    set(key, { status: "reading", text: "Reading (a minute or so)" });
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/outstanding-documents/uploads/${uploadId}/read`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return set(key, { status: "failed", text: said(b, `could not be read (${res.status})`), uploadId });
    const parts = [`${b.lines} line${b.lines === 1 ? "" : "s"} read`];
    if (b.duplicates) parts.push(`${b.duplicates} already listed`);
    if (b.unplaced) parts.push(`${b.unplaced} need a company`);
    if (b.skipped?.length) parts.push(`${b.skipped.length} could not be taken`);
    if (b.truncated) parts.push("the file was too long and was cut off");
    set(key, { status: "done", text: parts.join(", "), uploadId });
  }

  async function start(files: File[]) {
    if (!files.length) return;
    const fresh: Progress[] = files.map((f, i) => {
      const problem = fileProblem(f);
      return { key: `${Date.now()}-${i}`, name: f.name, status: problem ? "skipped" : "waiting", text: problem ? `Not sent: ${problem}` : "Waiting" };
    });
    setRows((all) => [...fresh, ...all]);
    setRunning(true);
    const todo = files.map((f, i) => ({ f, key: fresh[i].key })).filter((_, i) => fresh[i].status === "waiting");
    await inBatches(todo, 2, async ({ f, key }) => {
      set(key, { status: "uploading", text: "Uploading" });
      try {
        const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/outstanding-documents/uploads`, {
          method: "POST",
          headers: { "Content-Type": f.type || "application/octet-stream", "X-File-Name": encodeURIComponent(f.name) },
          body: f,
        });
        const b = await res.json().catch(() => ({}));
        if (!res.ok) {
          const blocked = res.status === 403 && !b.error && !b.issues;
          return set(key, { status: "failed", text: blocked ? "Blocked by the site's security filter (403). Ask for the upload path to be allowed." : said(b, `upload failed (${res.status})`) });
        }
        const u = b.upload as DocUpload;
        if (b.already && u.read_state === "read") return set(key, { status: "skipped", text: `Already uploaded as ${u.file_name} and read (${u.line_count ?? 0} lines)`, uploadId: u.id });
        await read(key, u.id);
      } catch (e) {
        set(key, { status: "failed", text: `Network error: ${(e as Error).message}` });
      }
    });
    setRunning(false);
    onDone();
  }

  return (
    <div>
      <div
        className={`${styles.drop} ${over ? styles.dropOn : ""}`}
        role="button" tabIndex={0} aria-label="Upload reports"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void start(Array.from(e.dataTransfer.files)); }}
      >
        <FileUp size={22} className={styles.dropIcon} aria-hidden />
        <div className={styles.dropTitle}>Drop reports here, or tap to choose</div>
        <div>Bank reconciliation reports or query lists: PDF, Excel (.xlsx) or CSV, up to 8 MB each, as many as you like at once. Each file is deleted once it has been read; the lines stay.</div>
        <input ref={input} className={styles.hidden} type="file" multiple accept={ACCEPT}
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void start(files); }} />
      </div>
      {rows.length > 0 && (
        <div className={`${page.card} ${styles.progress}`} aria-live="polite">
          {rows.map((r) => (
            <div key={r.key} className={styles.progressRow}>
              <span className={styles.progressName}>{r.name}</span>
              <span className={`${page.status} ${page[`s-${{ waiting: "neutral", uploading: "blue", reading: "blue", done: "green", failed: "red", skipped: "amber" }[r.status]}`]}`}>
                <span className={page.dot} />{r.text}
              </span>
              {r.status === "failed" && r.uploadId && !running && (
                <button type="button" className={page.miniBtn} onClick={() => void read(r.key, r.uploadId!).then(onDone)}>Try again</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Files({ uploads, act, busy }: { uploads: DocUpload[]; act: (m: "POST", p: string, b?: unknown) => Promise<Reply>; busy: boolean }) {
  if (!uploads.length) return null;
  const label = { waiting: "Not read", reading: "Reading", read: "Read", failed: "Could not be read" } as const;
  const tone = { waiting: "neutral", reading: "blue", read: "green", failed: "red" } as const;
  return (
    <details className={styles.section}>
      <summary className={page.summary}>Files uploaded ({uploads.length})</summary>
      <div className={page.card} style={{ marginTop: 8 }}>
        {uploads.map((u) => (
          <div key={u.id} className={styles.progressRow}>
            <span className={styles.progressName}>
              {u.file_name}
              <span className={page.small}> · {dateText(u.uploaded_at)} by {u.uploaded_by}{u.line_count != null ? ` · ${u.line_count} lines` : ""}</span>
              {u.file_deleted_at && <span className={page.small}> · file deleted after reading</span>}
              {u.read_error && <span className={page.small}> · {u.read_error}</span>}
            </span>
            <span className={`${page.status} ${page[`s-${tone[u.read_state]}`]}`}><span className={page.dot} />{label[u.read_state]}</span>
            {(u.read_state === "waiting" || u.read_state === "failed") && !u.file_deleted_at && (
              <button type="button" className={page.miniBtn} disabled={busy} onClick={() => void act("POST", `/uploads/${u.id}/read`)}>
                <RefreshCw size={12} style={{ marginRight: 4 }} />{u.read_state === "failed" ? "Try again" : "Read"}
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────

function ConcernSelect({ value, data, onChange, disabled }: { value: Concern; data: DocList; onChange: (c: Concern) => void; disabled?: boolean }) {
  return (
    <select className={page.select} value={value} disabled={disabled} aria-label="Concern" title={data.concerns[value]?.hint}
      onChange={(e) => onChange(e.target.value as Concern)}>
      {CONCERN_ORDER.map((c) => <option key={c} value={c}>{data.concerns[c]?.label ?? c}</option>)}
    </select>
  );
}

function CompanySelect({ value, companies, onChange, disabled, allowNone }: { value: string | null; companies: Company[]; onChange: (s: string) => void; disabled?: boolean; allowNone?: boolean }) {
  return (
    <select className={page.select} value={value ?? ""} disabled={disabled} aria-label="Company" onChange={(e) => onChange(e.target.value)}>
      {(allowNone || !value) && <option value="">Choose the company</option>}
      {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
    </select>
  );
}

function VatPill({ item }: { item: DocItem }) {
  if (!item.vat.flagged) return null;
  return (
    <span className={`${page.status} ${page["s-red"]}`} title={item.vat.reason ?? undefined}>
      <span className={page.dot} />VAT not recoverable{item.vat.at_risk_max != null ? `, up to ${pounds(item.vat.at_risk_max)}` : ""}
    </span>
  );
}

function Lead({ item }: { item: DocItem }) {
  return (
    <div>
      <div className={styles.payee}>{item.payee}</div>
      <div className={styles.meta}>
        {dateText(item.txn_date)}{item.bank_account ? ` · ${item.bank_account}` : ""}{item.card_holder ? ` · ${item.card_holder}` : ""}{item.reference ? ` · ${item.reference}` : ""}
      </div>
    </div>
  );
}

// ── To accept ────────────────────────────────────────────────────────────────

function ToAccept({ items, uploads, companies, data, act, call, busy }: {
  items: DocItem[]; uploads: DocUpload[]; companies: Company[]; data: DocList;
  act: (m: "POST" | "PATCH", p: string, b?: unknown) => Promise<Reply>;
  call: (m: "POST" | "PATCH", p: string, b?: unknown) => Promise<Reply>; busy: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  if (!items.length) return <div className={`${page.card} ${page.empty} ${styles.section}`}>Nothing waiting. Lines read from an upload appear here to accept.</div>;

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ready = items.filter((i) => i.entity_slug && !i.duplicate_of);
  const bulk = async (step: "accept" | "dismiss", ids: string[]) => {
    setResult(null);
    const r = await act("POST", "/bulk", { step, ids });
    if (r.ok) {
      const refused = (r.body.refused as Array<{ payee: string; issues: string[] }>) ?? [];
      const done = (r.body.done as string[]).length;
      setResult(`${done} ${step === "accept" ? "accepted onto the register" : "dismissed"}.${refused.length ? ` ${refused.length} not: ${refused.slice(0, 3).map((x) => `${x.payee} (${x.issues[0]})`).join("; ")}${refused.length > 3 ? "; ..." : ""}` : ""}`);
      setPicked(new Set());
    }
  };
  // Field changes save as they are made; the list refreshes after.
  const patch = async (id: string, body: Record<string, unknown>) => { await call("PATCH", `/${id}`, body); router.refresh(); };
  const setAllCompany = async (uploadItems: DocItem[], company: string) => {
    if (!company) return;
    for (const it of uploadItems.filter((x) => !x.entity_slug)) await call("PATCH", `/${it.id}`, { entity: company });
    router.refresh();
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>Read from uploads, waiting to accept</h2>
        <span className={page.small}>Check the company and the concern, then accept. Repeats of a listed transaction are marked.</span>
      </div>
      <div className={page.controls} style={{ marginBottom: 10 }}>
        <button type="button" className="btn-primary" disabled={busy || !ready.length} onClick={() => void bulk("accept", ready.map((i) => i.id))}>
          Accept all ready ({ready.length})
        </button>
        <button type="button" className="btn-secondary" disabled={busy || !picked.size} onClick={() => void bulk("accept", [...picked])}>Accept selected ({picked.size})</button>
        <button type="button" className="btn-secondary" disabled={busy || !picked.size} onClick={() => void bulk("dismiss", [...picked])}>Dismiss selected</button>
      </div>
      {result && <div className={styles.notice} role="status">{result}</div>}
      {byUpload(items, uploads).map(({ upload, items: list }) => (
        <div key={upload?.id ?? "none"} className={page.card} style={{ marginBottom: 12, overflow: "hidden" }}>
          <div className={styles.groupHead}>
            <input type="checkbox" className={styles.check} aria-label="Select all in this file"
              checked={list.every((i) => picked.has(i.id))}
              onChange={(e) => setPicked((p) => { const n = new Set(p); for (const i of list) { if (e.target.checked) n.add(i.id); else n.delete(i.id); } return n; })} />
            <strong>{upload?.file_name ?? "Added by hand"}</strong>
            <span>{list.length} lines</span>
            {list.some((i) => !i.entity_slug) && (
              <span className={styles.groupTotal}>
                <CompanySelect value={null} companies={companies} disabled={busy} onChange={(c) => void setAllCompany(list, c)} />
              </span>
            )}
          </div>
          {list.map((it) => (
            <div key={it.id} className={styles.item}>
              <input type="checkbox" className={styles.check} checked={picked.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Select ${it.payee}`} />
              <div>
                <Lead item={it} />
                <div className={styles.edit}>
                  <CompanySelect value={it.entity_slug} companies={companies} disabled={busy} onChange={(c) => void patch(it.id, { entity: c || null })} />
                  <ConcernSelect value={it.concern} data={data} disabled={busy} onChange={(c) => void patch(it.id, { concern: c })} />
                </div>
                <div className={styles.pills}>
                  {it.duplicate_of && <span className={`${page.status} ${page["s-amber"]}`}><span className={page.dot} />Already listed</span>}
                  <VatPill item={it} />
                  {it.source_line && <span className={page.small}>{it.source_line}</span>}
                  {it.note && <span className={page.small}>{it.note}</span>}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div className={styles.amount}>{amountText(it)}</div>
                <div className={page.controls} style={{ gap: 6 }}>
                  {it.duplicate_of ? (
                    <button type="button" className={page.miniBtn} disabled={busy || !it.entity_slug} title="Only if this is a second, separate transaction"
                      onClick={() => void act("POST", `/${it.id}/accept`, { allow_duplicate: true })}>Keep as separate</button>
                  ) : (
                    <button type="button" className={`${page.miniBtn} ${page.miniPrimary}`} disabled={busy || !it.entity_slug}
                      onClick={() => void act("POST", `/${it.id}/accept`)}>Accept</button>
                  )}
                  <button type="button" className={page.miniBtn} disabled={busy} onClick={() => void act("POST", `/${it.id}/dismiss`, {})}>Dismiss</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── The register ─────────────────────────────────────────────────────────────

function Register({ items, companies, data, act, busy }: {
  items: DocItem[]; companies: Company[]; data: DocList;
  act: (m: "POST" | "PATCH", p: string, b?: unknown) => Promise<Reply>; busy: boolean;
}) {
  const [f, setF] = useState<Filters>({ company: "", concern: "", q: "", holder: "" });
  const people = holders(items);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const shown = filtered(items, f);
  return (
    <div className={styles.section}>
      <div className={page.controls} style={{ marginBottom: 10 }}>
        {companies.length > 1 && (
          <select className={page.select} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} aria-label="Company">
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        )}
        <select className={page.select} value={f.concern} onChange={(e) => setF({ ...f, concern: e.target.value })} aria-label="Concern">
          <option value="">All concerns</option>
          {CONCERN_ORDER.map((c) => <option key={c} value={c}>{data.concerns[c]?.label ?? c}</option>)}
        </select>
        {people.length > 0 && (
          <select className={page.select} value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} aria-label="Card holder">
            <option value="">All card holders</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
            {items.some((i) => !i.card_holder) && <option value={NO_HOLDER}>{NO_HOLDER}</option>}
          </select>
        )}
        <input className={styles.input} placeholder="Search payee, reference, note" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search" />
        <button type="button" className="btn-secondary" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "Add by hand"}</button>
      </div>
      {adding && <AddForm companies={companies} data={data} act={act} busy={busy} onDone={() => setAdding(false)} />}
      {!items.length ? (
        <div className={`${page.card} ${page.empty}`}>Nothing on the register. Upload reports above, then accept their lines.</div>
      ) : !shown.length ? (
        <div className={`${page.card} ${page.empty}`}>Nothing matches.</div>
      ) : byMonth(shown).map(({ month, items: list }) => (
        <div key={month} className={page.card} style={{ marginBottom: 12, overflow: "hidden" }}>
          <div className={styles.groupHead}>
            <strong>{monthLabel(month)}</strong>
            <span>{list.length} item{list.length === 1 ? "" : "s"}</span>
            <span className={styles.groupTotal}>{pounds(list.reduce((t, i) => t + (i.direction === "spent" ? (i.currency === "GBP" ? i.amount : i.amount_gbp ?? 0) : 0), 0))}</span>
          </div>
          {list.map((it) => (
            <div key={it.id} className={`${styles.item} ${styles.itemNoCheck}`}>
              <div>
                <button type="button" className={styles.rowBtn} onClick={() => setOpenId(openId === it.id ? null : it.id)} aria-expanded={openId === it.id}>
                  <Lead item={it} />
                </button>
                <div className={styles.pills}>
                  <span className={`${page.status} ${page["s-neutral"]}`} title={data.concerns[it.concern]?.hint}>{data.concerns[it.concern]?.label ?? it.concern}</span>
                  <VatPill item={it} />
                  {companies.length > 1 && <span className={page.small}>{it.entity_name}</span>}
                  {it.chase_count > 0 && <span className={page.small}>Chased {it.chase_count}x, last {dateText(it.last_chased_at)}</span>}
                  {xeroLabel(it) && <span className={page.small}>{xeroLabel(it)}</span>}
                </div>
                {it.note && <div className={page.small} style={{ marginTop: 4 }}>{it.note}</div>}
              </div>
              <div className={styles.amount}>{amountText(it)}</div>
              {openId === it.id && <Detail item={it} data={data} act={act} busy={busy} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Detail({ item, data, act, busy }: { item: DocItem; data: DocList; act: (m: "POST" | "PATCH", p: string, b?: unknown) => Promise<Reply>; busy: boolean }) {
  const [note, setNote] = useState(item.note ?? "");
  const [holder, setHolder] = useState(item.card_holder ?? "");
  const [reason, setReason] = useState("");
  const [closing, setClosing] = useState(false);
  return (
    <div className={styles.detail}>
      <div className={styles.edit}>
        <ConcernSelect value={item.concern} data={data} disabled={busy} onChange={(c) => void act("PATCH", `/${item.id}`, { concern: c })} />
        <button type="button" className={page.miniBtn} disabled={busy} onClick={() => void act("POST", `/${item.id}/chased`)}>Chased today</button>
        <button type="button" className={`${page.miniBtn} ${page.miniPrimary}`} disabled={busy} onClick={() => void act("POST", `/${item.id}/received`, { note: note || null })}>Document received</button>
        <button type="button" className={page.miniBtn} disabled={busy} onClick={() => setClosing((c) => !c)}>Close without document</button>
      </div>
      <div className={styles.edit}>
        <input className={styles.input} value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Card holder or processor" aria-label="Card holder or processor" />
        <button type="button" className={page.miniBtn} disabled={busy || holder.trim() === (item.card_holder ?? "")}
          onClick={() => void act("PATCH", `/${item.id}`, { card_holder: holder.trim() || null })}>Save card holder</button>
      </div>
      <textarea className={styles.textarea} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note: what was asked for, what the client said" aria-label="Note" />
      <div className={page.controls}>
        <button type="button" className={page.miniBtn} disabled={busy || note === (item.note ?? "")} onClick={() => void act("PATCH", `/${item.id}`, { note })}>Save note</button>
        <span className={page.small}>
          {item.upload_name ? `From ${item.upload_name}${item.source_line ? `, ${item.source_line}` : ""}. ` : "Added by hand. "}
          {item.vat.reason ?? ""}
        </span>
      </div>
      {closing && (
        <div className={page.stack}>
          <textarea className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason"
            placeholder="Why it closes without its document (CFO only, 15 characters or more), e.g. supplier dissolved, cost disallowed for VAT" />
          <div>
            <button type="button" className="btn-primary" disabled={busy || reason.trim().length < 15}
              onClick={() => void act("POST", `/${item.id}/accept-without`, { reason })}>Close without document</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm({ companies, data, act, busy, onDone }: { companies: Company[]; data: DocList; act: (m: "POST", p: string, b?: unknown) => Promise<Reply>; busy: boolean; onDone: () => void }) {
  const [v, setV] = useState({ entity: companies.length === 1 ? companies[0].slug : "", txn_date: "", payee: "", amount: "", currency: "GBP", reference: "", bank_account: "", concern: "no_vat_invoice" as Concern, note: "" });
  const field = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <form className={`${page.card} ${styles.form}`} style={{ marginBottom: 12 }}
      onSubmit={async (e) => { e.preventDefault(); const r = await act("POST", "", v); if (r.ok) onDone(); }}>
      <CompanySelect value={v.entity || null} companies={companies} onChange={(c) => setV({ ...v, entity: c })} />
      <input className={styles.input} type="date" aria-label="Date" required {...field("txn_date")} />
      <input className={styles.input} placeholder="Payee" aria-label="Payee" required {...field("payee")} />
      <input className={styles.input} placeholder="Amount" aria-label="Amount" inputMode="decimal" required {...field("amount")} />
      <input className={styles.input} placeholder="Currency" aria-label="Currency" maxLength={3} {...field("currency")} />
      <input className={styles.input} placeholder="Bank account" aria-label="Bank account" {...field("bank_account")} />
      <input className={`${styles.input} ${styles.formWide}`} placeholder="Reference" aria-label="Reference" {...field("reference")} />
      <ConcernSelect value={v.concern} data={data} onChange={(c) => setV({ ...v, concern: c })} />
      <textarea className={`${styles.textarea} ${styles.formWide}`} placeholder="Note" aria-label="Note" {...field("note")} />
      <div className={styles.formWide}><button type="submit" className="btn-primary" disabled={busy}>Add to the register</button></div>
    </form>
  );
}

// ── Closed ───────────────────────────────────────────────────────────────────

function Closed({ items, data, act, busy }: { items: DocItem[]; data: DocList; act: (m: "POST", p: string, b?: unknown) => Promise<Reply>; busy: boolean }) {
  if (!items.length) return <div className={`${page.card} ${page.empty} ${styles.section}`}>Nothing closed yet.</div>;
  const label = { received: "Document received", accepted: "Closed without document", dismissed: "Dismissed" } as Record<string, string>;
  const tone = { received: "green", accepted: "amber", dismissed: "neutral" } as Record<string, string>;
  return (
    <div className={`${page.card} ${styles.section}`} style={{ overflow: "hidden" }}>
      {[...items].sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at))).map((it) => (
        <div key={it.id} className={`${styles.item} ${styles.itemNoCheck}`}>
          <div>
            <Lead item={it} />
            <div className={styles.pills}>
              <span className={`${page.status} ${page[`s-${tone[it.state]}`]}`}><span className={page.dot} />{label[it.state]}</span>
              <span className={page.small}>{data.concerns[it.concern]?.label}</span>
              <span className={page.small}>{dateText(it.closed_at)}{it.closed_by ? ` by ${it.closed_by}` : ""}</span>
            </div>
            {it.close_reason && <div className={page.small} style={{ marginTop: 4 }}>{it.close_reason}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div className={styles.amount}>{amountText(it)}</div>
            <button type="button" className={page.miniBtn} disabled={busy} onClick={() => void act("POST", `/${it.id}/reopen`)}>Reopen</button>
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

// One VAT return, in the order the work is done (VAT build spec 17 Nov 2026):
// 1 drop in each company's Xero export; 2 the checks (an adjustment with no
// accounting transaction waits for the CFO's reason); 3 the group return and
// the import file for the representative member; 4 the representative's
// export after the import, which confirms it. The ledger tie reads Xero, so it
// is asked for separately.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleCheck, CircleAlert, Download, ExternalLink, FileUp, FolderUp, Info } from "lucide-react";
import { readXlsxAll } from "@/modules/finance/lib/xlsx-read";
import { writeXlsx } from "@/modules/finance/lib/xlsx-write";
import {
  BOX_LABEL, importFileName, KIND_LABEL, longDate, money,
  type UploadKind, type VatCheck, type VatReturnView as View,
} from "@/modules/finance/lib/vat";
import page from "./Page.module.css";
import vat from "./Vat.module.css";

const BOXES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const FILE_BOXES = [1, 2, 4, 6, 7, 8, 9];
const TABS = ["VAT Return", "Transactions by VAT Box", "Transactions by Tax Rate"];

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type Msg = { ok: boolean; text: string } | null;

export default function VatReturnView({ slug, data, ledgerHref }: { slug: string; data: View; ledgerHref: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const r = data.return;
  const fixed = ["submitted", "paid", "part_paid", "outstanding"].includes(r.status);
  const api = `/api/finance/${encodeURIComponent(slug)}/vat/returns/${r.id}`;

  async function post(path: string, body: unknown) {
    const res = await fetch(`${api}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: b };
  }
  const failed = (x: { status: number; body: { error?: string; issues?: string[] } }) => x.body.error ?? x.body.issues?.join("; ") ?? `That did not work (${x.status})`;

  async function upload(entityId: string, kind: UploadKind, f: File | undefined) {
    if (!f) return;
    setBusy(`${entityId}:${kind}`); setMsg(null);
    try {
      const buf = await f.arrayBuffer();
      const all = await readXlsxAll(buf);
      const sheets = Object.fromEntries(TABS.filter((t) => all[t]).map((t) => [t, all[t]]));
      if (!sheets["VAT Return"]) throw new Error(`${f.name} has no "VAT Return" tab. Export the return from Xero as Excel and upload that file.`);
      const x = await post("uploads", { entity_id: entityId, kind, file_name: f.name, sha256: await sha256(buf), sheets });
      if (!x.ok) setMsg({ ok: false, text: failed(x) });
      else {
        const w = (x.body.warnings as string[] | undefined) ?? [];
        setMsg({ ok: true, text: `${f.name}: ${Number(x.body.lines).toLocaleString("en-GB")} lines read.${w.length ? ` Note: ${w.join("; ")}` : ""}` });
        router.refresh();
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  }

  async function makeImport() {
    const g = data.group;
    if (!g) return;
    setBusy("import"); setMsg(null);
    const x = await post("imports", { boxes: Object.fromEntries(FILE_BOXES.map((b) => [b, g.import[b]])) });
    setBusy(null);
    if (!x.ok) { setMsg({ ok: false, text: failed(x) }); return; }
    download(writeXlsx("VAT Return Import", g.template_rows), importFileName(r.period_end, data.imports.length + 1));
    setMsg({ ok: true, text: "Import file downloaded and recorded. Import it into the representative's return in Xero, then upload its export below." });
    router.refresh();
  }

  async function saveWorkbook() {
    setBusy("workbook"); setMsg(null);
    const x = await post("workbook", {});
    setBusy(null);
    if (!x.ok) { setMsg({ ok: false, text: failed(x) }); return; }
    setMsg({ ok: true, text: "Building the workbook. It takes about a minute; refresh to see the link." });
    router.refresh();
  }

  const uploadOf = (entityId: string, kind: UploadKind) => data.uploads.find((u) => u.entity_id === entityId && u.kind === kind);
  const repId = r.representative_id;
  const rep = data.members.find((m) => m.entity_id === repId);

  return (
    <div className={page.stack} style={{ gap: 16 }}>
      {msg && <div className={msg.ok ? page.small : page.error} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}

      <section className={page.card} aria-label="Exports">
        <div className={page.cardHead}><h2>1. Each company&apos;s export</h2></div>
        <p className={`${page.small} ${page.pad}`} style={{ margin: 0, paddingBottom: 0 }}>
          In Xero: Accounting, VAT returns, open the period&apos;s return, Export to Excel. One file per company. A new file replaces the last one.
        </p>
        <div>
          {data.members.map((m) => {
            const u = uploadOf(m.entity_id, "member_export");
            const key = `${m.entity_id}:member_export`;
            return (
              <div key={m.entity_id} className={vat.member}>
                <span className={vat.memberName}>{m.entity_name}{m.entity_id === repId && r.kind === "group" ? " (representative)" : ""}</span>
                {u ? (
                  <span className={page.small}>
                    {u.file_name}, box 5 {money(u.boxes?.["5"])}{u.period_start && u.period_end ? `, ${longDate(u.period_start)} to ${longDate(u.period_end)}` : ""}
                  </span>
                ) : <span className={page.small}>Not uploaded yet</span>}
                {!fixed && (
                  <label className={`${page.miniBtn} ${vat.fileBtn}`} aria-disabled={busy !== null}>
                    <FileUp size={13} aria-hidden="true" />{busy === key ? "Reading..." : u ? "Replace" : "Upload"}
                    <input type="file" accept=".xlsx" disabled={busy !== null} onChange={(e) => { upload(m.entity_id, "member_export", e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={page.card} aria-label="Checks">
        <div className={page.cardHead}>
          <h2>2. Checks</h2>
          <span className={`${page.status} ${page[data.checks.ok ? "s-green" : "s-amber"]}`}><span className={page.dot} />{data.checks.ok ? "All clear" : `${data.checks.blocking.length} to resolve`}</span>
        </div>
        {data.checks.checks.map((c) => <Check key={c.key} c={c} fixed={fixed} post={post} failed={failed} onDone={() => router.refresh()} />)}
      </section>

      {r.kind === "group" && (
        <section className={page.card} aria-label="Group return">
          <div className={page.cardHead}><h2>3. The group return and the import file</h2></div>
          {!data.group ? (
            <div className={page.empty}>The group return is built once every company&apos;s export is in and the checks are clear.</div>
          ) : (
            <>
              <div className={vat.scroll}>
                <table className={vat.table}>
                  <thead>
                    <tr>
                      <th>Box</th>
                      {data.group.columns.map((c) => <th key={c.entity_id} className={vat.num}>{c.entity_name}</th>)}
                      <th className={vat.num}>Group</th>
                      <th className={vat.num}>In {rep?.entity_name ?? "the representative"}&apos;s return now</th>
                      <th className={vat.num}>To import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BOXES.map((b) => (
                      <tr key={b} className={b === 5 ? vat.strong : undefined}>
                        <td><span className={vat.box}>{b}</span> {BOX_LABEL[b]}</td>
                        {data.group!.columns.map((c) => <td key={c.entity_id} className={vat.num}>{money(c.own[b])}</td>)}
                        <td className={vat.num}>{money(data.group!.target[b])}</td>
                        <td className={vat.num}>{money(data.group!.already[b])}</td>
                        <td className={vat.num}>{FILE_BOXES.includes(b) ? money(data.group!.import[b]) : "Xero works it out"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={`${page.pad} ${page.stack}`} style={{ borderTop: "1px solid var(--bd)" }}>
                <p className={page.small} style={{ margin: 0 }}>
                  Box 5 is signed here: negative is a repayment due from HMRC ({money(Math.abs(data.group.target[5]))} {data.group.target[5] < 0 ? "to reclaim" : "to pay"}).
                  Boxes 6 to 9 are whole pounds. The import is the group less what is already in the representative&apos;s return, so a second file never double counts.
                </p>
                {data.group.nothing_to_import ? (
                  <p style={{ margin: 0, fontSize: 13 }}><CircleCheck size={14} aria-hidden="true" style={{ verticalAlign: -2, color: "var(--success, #2E7D32)" }} /> Nothing to import: the representative&apos;s return already shows the group.</p>
                ) : !fixed && (
                  <div className={page.controls}>
                    <button className="btn-primary" disabled={busy !== null} onClick={makeImport} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Download size={15} aria-hidden="true" />{busy === "import" ? "Making the file..." : data.imports.length ? "Download a correcting import file" : "Download the import file"}
                    </button>
                  </div>
                )}
                {data.imports.length > 0 && (
                  <details>
                    <summary className={page.summary}>Import files made ({data.imports.length})</summary>
                    <ul className={vat.steps}>
                      {data.imports.map((i) => <li key={i.id}>{i.kind === "group" ? "Group" : i.kind === "correction" ? "Correction" : "Reset"}, {longDate(i.generated_at)} by {i.generated_by}{i.confirmed_at ? ", confirmed" : ""}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {r.kind === "group" && rep && (data.imports.length > 0 || uploadOf(rep.entity_id, "representative_post_import")) && (
        <section className={page.card} aria-label="Confirm the import">
          <div className={page.cardHead}><h2>4. Confirm the import</h2></div>
          <div className={vat.member}>
            <span className={vat.memberName}>{rep.entity_name}, after the import</span>
            {(() => {
              const u = uploadOf(rep.entity_id, "representative_post_import");
              return u ? <span className={page.small}>{u.file_name}, box 5 {money(u.boxes?.["5"])}</span> : <span className={page.small}>Export the return again from Xero once the file is imported</span>;
            })()}
            {!fixed && (
              <label className={`${page.miniBtn} ${vat.fileBtn}`}>
                <FileUp size={13} aria-hidden="true" />{busy === `${rep.entity_id}:representative_post_import` ? "Reading..." : "Upload"}
                <input type="file" accept=".xlsx" disabled={busy !== null} onChange={(e) => { upload(rep.entity_id, "representative_post_import", e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
          {data.confirmation && (
            <div className={page.pad} style={{ borderTop: "1px solid var(--bd)", fontSize: 13 }}>
              {!data.confirmation.length ? (
                <><CircleCheck size={14} aria-hidden="true" style={{ verticalAlign: -2, color: "var(--success, #2E7D32)" }} /> The representative&apos;s return now shows the group on every box. It is ready to submit in Xero.</>
              ) : (
                <>
                  <CircleAlert size={14} aria-hidden="true" style={{ verticalAlign: -2, color: "#9A3412" }} /> Still different from the group:
                  <ul className={vat.steps}>{data.confirmation.map((d) => <li key={d.box}>Box {d.box}: should be {money(d.want)}, shows {money(d.got)}</li>)}</ul>
                  <span className={page.small}>Step 3 now shows only the difference; download the correcting file and import it.</span>
                </>
              )}
            </div>
          )}
        </section>
      )}

      <section className={page.card} aria-label="Workbook">
        <div className={page.cardHead}>
          <h2>Workbook</h2>
          {data.workbook.drive_set && data.uploads.length > 0 && (
            <button className="btn-secondary" disabled={busy !== null} onClick={saveWorkbook} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <FolderUp size={15} aria-hidden="true" />{busy === "workbook" ? "Starting..." : data.workbook.link ? "Save again" : "Save to the client's drive"}
            </button>
          )}
        </div>
        <div className={`${page.pad} ${page.stack}`} style={{ fontSize: 13 }}>
          <span className={page.small}>
            The consolidated file: a GROUP sheet (each company, the group and the adjustment, as formulas on the company tabs),
            each company&apos;s three Xero tabs and the checks, saved in the period&apos;s VAT folder. Saving again replaces the file it made before.
          </span>
          {!data.workbook.drive_set && <span className={page.warn}>No shared drive is set for this VAT registration yet.</span>}
          {data.uploads.some((u) => u.kind === "member_export" && !u.has_sheets) && (
            <span className={page.warn}>Some exports were uploaded before the workbook existed and did not keep Xero&apos;s tabs: upload them again first.</span>
          )}
          {data.workbook.link && (
            <span>
              <a href={data.workbook.link} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {data.workbook.name ?? "Open the workbook"}<ExternalLink size={12} aria-hidden="true" />
              </a>
              <span className={page.small}> saved {longDate(data.workbook.saved_at)}</span>
            </span>
          )}
          {data.workbook.requested_at && (!data.workbook.saved_at || data.workbook.saved_at < data.workbook.requested_at) && !data.workbook.error && (
            <span className={page.small}>Being built (asked {longDate(data.workbook.requested_at)} by {data.workbook.requested_by}). Refresh in a minute.</span>
          )}
          {data.workbook.error && <span className={page.warn}>The last save failed: {data.workbook.error}</span>}
        </div>
      </section>

      <section className={page.card} aria-label="Ledger tie">
        <div className={page.cardHead}>
          <h2>Tie to the ledger</h2>
          {ledgerHref && <Link prefetch={false} className={page.miniBtn} href={ledgerHref}>Check against Xero</Link>}
        </div>
        {!data.ledger ? (
          <p className={`${page.small} ${page.pad}`} style={{ margin: 0 }}>
            <Info size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Each company&apos;s VAT control account movement in the period, less clearing journals and HMRC receipts, against its own return. It reads Xero, so it runs when asked.
          </p>
        ) : (
          <div className={vat.scroll}>
            <table className={vat.table}>
              <thead><tr><th>Company</th><th className={vat.num}>Movement</th><th className={vat.num}>Taken out</th><th className={vat.num}>Trading</th><th className={vat.num}>Per return</th><th className={vat.num}>Difference</th></tr></thead>
              <tbody>
                {data.ledger.map((l) => l.error ? (
                  <tr key={l.entity}><td>{l.entity}</td><td colSpan={5} className={page.warn}>{l.error}</td></tr>
                ) : (
                  <tr key={l.entity}>
                    <td>{l.entity}{l.account ? <span className={page.small}> ({l.account})</span> : null}
                      {l.excluded_items?.length ? <div className={page.small}>{l.excluded_items.join("; ")}</div> : null}</td>
                    <td className={vat.num}>{money(l.movement)}</td>
                    <td className={vat.num}>{money(l.excluded)}</td>
                    <td className={vat.num}>{money(l.trading)}</td>
                    <td className={vat.num}>{money(l.from_return)}</td>
                    <td className={vat.num} style={{ color: l.difference ? "#9A3412" : undefined }}>{money(l.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Check({ c, fixed, post, failed, onDone }: {
  c: VatCheck;
  fixed: boolean;
  post: (path: string, body: unknown) => Promise<{ ok: boolean; status: number; body: { error?: string; issues?: string[] } }>;
  failed: (x: { status: number; body: { error?: string; issues?: string[] } }) => string;
  onDone: () => void;
}) {
  const Icon = c.ok ? CircleCheck : CircleAlert;
  return (
    <div className={vat.check}>
      <div className={vat.checkHead}>
        <Icon size={15} aria-hidden="true" style={{ flex: "none", marginTop: 2, color: c.ok ? "var(--success, #2E7D32)" : c.blocking ? "#9A3412" : "var(--sub)" }} />
        <span>{c.said}</span>
      </div>
      {c.items.length > 0 && (
        <details open={c.key === "adjustments" && !c.ok} style={{ marginTop: 6, paddingLeft: 23 }}>
          <summary className={page.summary}>{c.items.length} line{c.items.length === 1 ? "" : "s"}</summary>
          {c.key === "adjustments"
            ? c.items.map((it) => <Adjustment key={String(it.key)} it={it} fixed={fixed} post={post} failed={failed} onDone={onDone} />)
            : <Items items={c.items} />}
        </details>
      )}
    </div>
  );
}

function Items({ items }: { items: Array<Record<string, unknown>> }) {
  const cols = Object.keys(items[0] ?? {}).filter((k) => k !== "key" && k !== "line_id");
  return (
    <div className={vat.scroll}>
      <table className={vat.table}>
        <thead><tr>{cols.map((k) => <th key={k} className={typeof items[0][k] === "number" ? vat.num : undefined}>{k.replace(/_/g, " ")}</th>)}</tr></thead>
        <tbody>
          {items.slice(0, 200).map((it, i) => (
            <tr key={i}>{cols.map((k) => {
              const v = it[k];
              return <td key={k} className={typeof v === "number" ? vat.num : undefined}>{typeof v === "number" ? (k === "box" ? v : money(v)) : /date|created_on/.test(k) ? longDate(String(v ?? "")) : String(v ?? "")}</td>;
            })}</tr>
          ))}
        </tbody>
      </table>
      {items.length > 200 && <p className={page.small}>Showing 200 of {items.length.toLocaleString("en-GB")}.</p>}
    </div>
  );
}

function Adjustment({ it, fixed, post, failed, onDone }: {
  it: Record<string, unknown>;
  fixed: boolean;
  post: (path: string, body: unknown) => Promise<{ ok: boolean; status: number; body: { error?: string; issues?: string[] } }>;
  failed: (x: { status: number; body: { error?: string; issues?: string[] } }) => string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function accept() {
    setBusy(true); setErr(null);
    const x = await post("adjustments", { line_id: it.line_id, reason, evidence_ref: evidence });
    setBusy(false);
    if (!x.ok) setErr(failed(x)); else onDone();
  }
  return (
    <div className={vat.adj}>
      <div style={{ gridColumn: "1 / -1", fontSize: 13 }}>
        <strong>{String(it.entity)}</strong>, box {String(it.box)}: {money(Number(it.vat))} VAT, {money(Number(it.net))} net. {String(it.details ?? "")}
        <span className={page.small}> Dated {longDate(String(it.date ?? ""))}{it.created_on ? `, made ${longDate(String(it.created_on))}` : ""}.</span>
        {it.accepted ? <span className={page.small}> Accepted.</span> : null}
      </div>
      {!it.accepted && !fixed && it.line_id ? (
        <>
          <input className={vat.input} placeholder="Why it is right (CFO)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <input className={vat.input} placeholder="Evidence (file or note)" value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-label="Evidence" />
          <button className="btn-secondary" disabled={busy || reason.trim().length < 10} onClick={accept}>{busy ? "Saving..." : "Accept"}</button>
          {err && <div className={page.error} role="alert" style={{ gridColumn: "1 / -1" }}>{err}</div>}
        </>
      ) : null}
    </div>
  );
}

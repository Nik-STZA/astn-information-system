"use client";

// One month's payroll: upload the provider's salary report (cut down in the
// browser to employee codes and figures), set each code's role, confirm the
// capitalisation shares carried forward from last month, propose the month's
// journals to the Journals page, and build the working file on the client's
// drive. Nothing here writes to Xero.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { periodChoices, periodLong } from "@/modules/finance/lib/recs";
import { readXlsxAll } from "@/modules/finance/lib/xlsx-read";
import { KIND_LABEL, ROLE_LABEL, ROLES, gbp, payDateIssue, stripReport, type PayrollMonth, type Role } from "@/modules/finance/lib/payroll";
import page from "./Page.module.css";
import styles from "./Accruals.module.css";

const said = (b: Record<string, unknown>, fallback: string) =>
  String((b.issues as string[] | undefined)?.join(" ") ?? b.error ?? fallback);

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function PayrollView({ slug, data }: { slug: string; data: PayrollMonth }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(data.run?.pay_date ?? "");
  const [roles, setRoles] = useState<Record<string, Role | "">>({});
  const [shares, setShares] = useState<Record<string, Record<string, string>>>({});
  const [shareNote, setShareNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const base = `/finance/clients/${encodeURIComponent(slug)}`;
  const run = data.run;
  const s = data.settings;
  const projects = s?.projects ?? [];

  const call = async (method: "POST" | "PUT", path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/payroll/${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const out = { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> };
    setBusy(false);
    if (!out.ok) setError(said(out.body, "That did not work"));
    return out;
  };

  const upload = async (f: File) => {
    const dateIssue = payDateIssue(data.period, payDate);
    if (dateIssue) { setError(dateIssue); return; }
    let sheets: Record<string, string[][]>;
    const buf = await f.arrayBuffer();
    try { sheets = await readXlsxAll(buf); } catch { setError(`${f.name} is not an Excel workbook.`); return; }
    const tab = sheets["Salary Report"] ? "Salary Report" : Object.keys(sheets).find((k) => stripReport(sheets[k]));
    const cut = tab ? stripReport(sheets[tab]) : null;
    if (!cut) { setError(`${f.name} has no sheet with an EmpCode heading. Upload the provider's salary report.`); return; }
    const r = await call("POST", "runs", { period: data.period, pay_date: payDate, source_name: f.name, source_sha256: await sha256(buf), rows: cut.rows });
    if (!r.ok) return;
    setNotice(r.body.unchanged ? "That file is already this month's report." : `${r.body.employees} employees read${r.body.replaced ? ", replacing the earlier upload" : ""}. ${cut.dropped} personal columns stayed on your computer.`);
    router.refresh();
  };

  const roleEdits = Object.entries(roles).filter(([c, r]) => r && r !== data.roles[c]);
  const saveRoles = async () => {
    const r = await call("PUT", "roles", { roles: Object.fromEntries(roleEdits) });
    if (!r.ok) return;
    setRoles({});
    setNotice("Roles saved.");
    router.refresh();
  };

  // Contractors, by code: their cost is the net of their bills dated in the month, read from Xero.
  const contractors = run?.contractors ?? [];
  const readBills = async (quiet = false) => {
    if (!run) return;
    const r = await call("POST", `runs/${run.id}/contractors`, {});
    if (!r.ok) return;
    if (!quiet) setNotice("Contractors' bills read from Xero.");
    router.refresh();
  };
  // Read them once for a month that has not had them read; after that, on request.
  const autoRead = useRef(false);
  useEffect(() => {
    if (autoRead.current || !run || !contractors.length || run.contractors_read_at) return;
    autoRead.current = true;
    void readBills(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);
  const shareCodes = [...(run?.employees.map((e) => e.emp_code) ?? []), ...contractors.map((c) => c.code)];

  const shareOf = (code: string, p: string) => shares[code]?.[p] ?? (run?.alloc[code]?.[p] !== undefined ? String(run.alloc[code][p]) : "");
  const sharesEdited = Object.keys(shares).length > 0;
  const settled = Boolean(run?.alloc_confirmed_at) && !sharesEdited;
  const confirmShares = async () => {
    if (!run) return;
    const alloc = Object.fromEntries(shareCodes.map((code) => [code, Object.fromEntries(projects
      .map((p) => [p, Number(shareOf(code, p) || 0)]).filter(([, v]) => Number(v) > 0))]));
    const r = await call("POST", `runs/${run.id}/alloc`, { alloc, note: shareNote.trim() });
    if (!r.ok) return;
    setShares({});
    setShareNote("");
    setNotice("Shares confirmed for the month.");
    router.refresh();
  };

  const propose = async () => {
    if (!run) return;
    const r = await call("POST", `runs/${run.id}/propose`, {});
    if (!r.ok) return;
    const made = (r.body.proposed as Array<{ jnl: string }> | undefined) ?? [];
    setNotice(made.length ? `${made.map((j) => j.jnl).join(", ")} proposed. Approve them on the Journals page.` : "Every journal for the month is already proposed.");
    router.refresh();
  };

  const workbook = async () => {
    if (!run) return;
    const r = await call("POST", `runs/${run.id}/workbook`, {});
    if (!r.ok) return;
    setNotice("Building the working file. It takes a minute or two; refresh to see the link.");
    router.refresh();
  };

  const total = useMemo(() => (run ? run.employees.reduce((a, e) => a + e.pay_bill, 0) : 0), [run]);
  const live = new Set(run?.journals.filter((j) => j.state !== "rejected").map((j) => j.kind) ?? []);
  const toPropose = run?.preview.journals.filter((j) => !live.has(j.kind)) ?? [];
  const blocked = !run ? null : run.no_role.length ? "Set every employee's role first."
    : !run.alloc_confirmed_at ? "Confirm the month's capitalisation shares first."
    : run.preview.issues.length ? "Clear the issues above first." : null;

  return (
    <div>
      <div className={styles.bar}>
        <select aria-label="Month" className={styles.pick} value={data.period}
          onChange={(e) => router.push(`${base}/payroll?period=${e.target.value}`)}>
          {periodChoices(data.period).map((p) => <option key={p} value={p}>{periodLong(p)}</option>)}
        </select>
        <label className={styles.row}>
          <span className={page.label}>Pay date</span>
          <input type="date" className={styles.pick} value={payDate} min={`${data.period}-01`} max={`${data.period}-31`} onChange={(e) => setPayDate(e.target.value)} />
        </label>
        <button type="button" className="btn-secondary" disabled={busy || !s} onClick={() => file.current?.click()}>
          <Upload size={14} aria-hidden="true" />{run ? "Replace the report" : "Upload the salary report"}
        </button>
        <input ref={file} type="file" hidden accept=".xlsx"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      </div>

      {error && <div className={page.error} role="alert">{error}</div>}
      {notice && <div className={page.ok} role="status">{notice}</div>}

      {!s && (
        <div className={`${page.card} ${page.empty}`}>Payroll is not set up for this client yet: the companies, accounts and projects are needed before a report can be read.</div>
      )}

      {s && !run && (
        <div className={`${page.card} ${page.empty}`}>
          No salary report for {periodLong(data.period)} yet.{data.last_period ? ` The last month uploaded is ${periodLong(data.last_period)}; its capitalisation shares will be carried forward for you to confirm.` : ""}
        </div>
      )}

      {s && run && (
        <>
          <section className={styles.section}>
            <div className={`${page.card} ${page.pad}`}>
              <div className={page.meta}>
                <div><div className={page.metaLabel}>Report</div><div className={page.metaValue}>{run.source_name}</div></div>
                <div><div className={page.metaLabel}>Pay date</div><div className={page.metaValue}>{run.pay_date}</div></div>
                <div><div className={page.metaLabel}>Employees</div><div className={page.metaValue}>{run.employees.length}</div></div>
                <div><div className={page.metaLabel}>Gross pay</div><div className={page.metaValue}>{gbp(total)}</div></div>
                <div><div className={page.metaLabel}>Uploaded</div><div className={page.metaValue}>{run.uploaded_by}, {when(run.uploaded_at)}</div></div>
              </div>
              {run.missing.length > 0 && <p className={page.small} style={{ marginTop: 10 }}>Not in this export, so taken as nil: {run.missing.join(", ")}.</p>}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>Roles <span className={styles.count}>by employee code</span></h2>
            <div className={page.card}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Code</th><th>Role</th><th className={styles.num}>Basic</th><th className={styles.num}>Employer cost</th></tr></thead>
                  <tbody>
                    {run.employees.map((e) => (
                      <tr key={e.emp_code}>
                        <td>{e.emp_code}</td>
                        <td>
                          <select aria-label={`Role for ${e.emp_code}`} className={styles.pick} value={roles[e.emp_code] ?? data.roles[e.emp_code] ?? ""}
                            onChange={(ev) => setRoles({ ...roles, [e.emp_code]: ev.target.value as Role })}>
                            {!data.roles[e.emp_code] && <option value="">Choose</option>}
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        </td>
                        <td className={styles.num}>{gbp(e.basic)}</td>
                        <td className={styles.num}>{gbp(e.basic + e.er_nic + e.er_pension)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(roleEdits.length > 0 || run.no_role.length > 0) && (
                <div className={`${page.pad} ${styles.row}`}>
                  {run.no_role.length > 0 && <span className={styles.warn}>No role yet for {run.no_role.join(", ")}.</span>}
                  <button type="button" className="btn-primary" disabled={busy || !roleEdits.length} onClick={saveRoles}>Save roles</button>
                </div>
              )}
            </div>
          </section>

          {projects.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.h2}>Capitalised development <span className={styles.count}>percent of employer cost, by project</span></h2>
              <div className={page.card}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Code</th>{projects.map((p) => <th key={p} className={styles.num}>{p}</th>)}</tr></thead>
                    <tbody>
                      {shareCodes.map((code) => {
                        const c = contractors.find((x) => x.code === code);
                        return (
                          <tr key={code}>
                            <td>{code}{c && <span className={page.small}> contractor</span>}</td>
                            {projects.map((p) => (
                              <td key={p} className={styles.num}>
                                <input aria-label={`${code} ${p} percent`} inputMode="decimal" className={styles.input} style={{ width: 64, textAlign: "right" }}
                                  value={shareOf(code, p)}
                                  onChange={(ev) => setShares({ ...shares, [code]: { ...(shares[code] ?? {}), [p]: ev.target.value } })} />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      {Object.keys(run.preview.by_project).length > 0 && (
                        <tr><td><strong>Capitalised</strong></td>{projects.map((p) => <td key={p} className={styles.num}>{run.preview.by_project[p] ? gbp(run.preview.by_project[p]) : ""}</td>)}</tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {contractors.length > 0 && (
                  <div className={`${page.pad} ${styles.row}`}>
                    <span className={page.small}>
                      {contractors.map((c) => `${c.code}: ${c.cost == null ? "bills not read yet" : c.cost ? `${gbp(c.cost)} net, from bill${c.bills.length === 1 ? "" : "s"} ${c.bills.join(", ")}` : "no approved bill dated this month"}`).join("; ")}.
                      {run.contractors_read_at ? ` Read from Xero ${when(run.contractors_read_at)}.` : ""}
                    </span>
                    <button type="button" className="btn-text" disabled={busy} onClick={() => readBills()}>
                      <RefreshCw size={13} aria-hidden="true" />Read the bills again
                    </button>
                  </div>
                )}
                <div className={`${page.pad} ${styles.row}`}>
                  {settled
                    ? <span className={page.small}><CheckCircle2 size={13} aria-hidden="true" /> Confirmed by {run.alloc_confirmed_by}, {when(run.alloc_confirmed_at)}{run.alloc_note ? `, from: ${run.alloc_note}` : ""}.</span>
                    : <>
                        <span className={page.small}>{data.last_period ? `Carried forward from ${periodLong(data.last_period)}. ` : ""}Enter this month&apos;s shares, say where they came from, and confirm.</span>
                        <input aria-label="Where the shares came from" className={styles.input} style={{ flex: "1 1 220px" }} maxLength={200}
                          placeholder="Where from, e.g. development lead, email 4 Nov" value={shareNote} onChange={(e) => setShareNote(e.target.value)} />
                      </>}
                  <button type="button" className="btn-primary" disabled={busy || settled || shareNote.trim().length < 3} onClick={confirmShares}>Confirm shares</button>
                </div>
              </div>
            </section>
          )}

          <section className={styles.section}>
            <h2 className={styles.h2}>The month&apos;s journals</h2>
            {run.preview.issues.length > 0 && (
              <div className={page.error} role="alert">{run.preview.issues.map((i) => <div key={i}>{i}</div>)}</div>
            )}
            <div className={page.stack}>
              {run.preview.journals.map((j) => {
                const made = run.journals.find((x) => x.kind === j.kind && x.state !== "rejected");
                return (
                  <div key={j.kind} className={page.card}>
                    <div className={page.cardHead}>
                      <h2>{KIND_LABEL[j.kind]} <span className={styles.count}>{data.entities.find((e) => e.slug === j.entity)?.name ?? j.entity}, {j.date}</span></h2>
                      {made ? <span className={`${page.status} ${page["s-blue"]}`}>{made.jnl} {made.state.replace("_", " ")}</span> : null}
                    </div>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead><tr><th>Account</th><th>Description</th><th className={styles.num}>Debit</th><th className={styles.num}>Credit</th></tr></thead>
                        <tbody>
                          {j.lines.map((l, i) => (
                            <tr key={i}>
                              <td>{l.account_code}</td><td>{l.description}</td>
                              <td className={styles.num}>{l.amount > 0 ? gbp(l.amount) : ""}</td>
                              <td className={styles.num}>{l.amount < 0 ? gbp(-l.amount) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.row} style={{ marginTop: 12 }}>
              {toPropose.length > 0 && <button type="button" className="btn-primary" disabled={busy || !!blocked} onClick={propose}>Propose {toPropose.length} journal{toPropose.length === 1 ? "" : "s"}</button>}
              {blocked && toPropose.length > 0 && <span className={page.small}>{blocked}</span>}
              {run.journals.some((j) => j.state !== "rejected") && <Link className={styles.link} href={`${base}/journals`}>Open the Journals page</Link>}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>Working file</h2>
            <div className={`${page.card} ${page.pad}`}>
              <p className={page.small} style={{ marginTop: 0 }}>
                Built on the client&apos;s drive in {s.folder || "the payroll folder"}, from the provider&apos;s export kept there ({run.source_name}). Its salary report tab stays exactly as the provider sent it.
              </p>
              {run.workbook.link && <p className={page.small}><a className={styles.link} href={run.workbook.link} target="_blank" rel="noreferrer">{run.workbook.name}</a>, saved {when(run.workbook.saved_at)}.</p>}
              {run.workbook.error && <p className={styles.err}>{run.workbook.error}</p>}
              {run.workbook.requested_at && !run.workbook.saved_at && !run.workbook.error && <p className={page.small}>Requested {when(run.workbook.requested_at)}.</p>}
              <button type="button" className="btn-secondary" disabled={busy || !s.drive_set} onClick={workbook}>
                <FileSpreadsheet size={14} aria-hidden="true" />{run.workbook.link ? "Build it again" : "Build the working file"}
              </button>
              {!s.drive_set && <p className={page.small}>No shared drive is set in the payroll settings.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

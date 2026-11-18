"use client";

// Upload a master mapping file (part 3 of docs/management-pack-templates-plan.md):
// the client's own Code / Name / P&L Mapping 1 / P&L Mapping 2 / BS Mapping
// file, group wide. finance-api matches it to every company's Xero accounts on
// code and name, translates the headings through the client's pack template,
// and shows what would change. Untick anything that should stay as it is, then
// apply it in one step; it is recorded as uploaded from that file.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import type { MasterChange, MasterPlan, ReportingCategory } from "@/modules/finance/lib/coa";
import { readMasterFile } from "@/modules/finance/lib/master-file";
import styles from "./Page.module.css";

const KIND: Record<MasterChange["kind"], string> = { new: "New", category: "Moves line", subline: "Sub-line", approve: "Approve" };

function Issues({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details style={{ borderTop: "1px solid var(--bd)", paddingTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>{title} ({items.length.toLocaleString("en-GB")})</summary>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--sub)" }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </details>
  );
}

export default function MasterUpload({ slug, categories }: { slug: string; categories: ReportingCategory[] }) {
  const router = useRouter();
  const label = useMemo(() => new Map(categories.map((c) => [c.key, c.label])), [categories]);
  const [file, setFile] = useState<{ name: string; table: string[][] } | null>(null);
  const [plan, setPlan] = useState<MasterPlan | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [approve, setApprove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);

  async function post(path: "preview" | "apply", body: object) {
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/coa-mapping-master/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  }

  async function choose(f: File | undefined, withApproval = approve) {
    if (!f) return;
    setBusy(true); setMsg(null); setPlan(null); setExcluded(new Set());
    try {
      const table = await readMasterFile(f);
      setFile({ name: f.name, table });
      const r = await post("preview", { fileName: f.name, table, approve: withApproval });
      if (!r.ok) setMsg({ ok: false, text: r.body.error ?? `That did not work (${r.status})` });
      else setPlan(r.body as MasterPlan);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  async function apply() {
    if (!file || !plan) return;
    setBusy(true); setMsg(null);
    const r = await post("apply", { fileName: file.name, table: file.table, exclude: [...excluded], approve });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.body.error ?? `That did not work (${r.status})`, list: r.body.errors }); return; }
    const saved = (r.body.saved as { entity: string; saved: number; approved: number }[]) ?? [];
    const total = saved.reduce((n, s) => n + s.saved, 0);
    setMsg({ ok: true, text: `Saved ${total.toLocaleString("en-GB")} account(s) from ${file.name}${approve ? ", approved" : ", not yet approved"}.` });
    setPlan(null); setFile(null);
    router.refresh();
  }

  const toggle = (k: string) => setExcluded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const total = plan ? plan.entities.reduce((n, e) => n + e.changes.length, 0) : 0;
  const chosen = total - excluded.size;
  const lineOf = (cat: string, sub: string | null) => `${label.get(cat) ?? cat}${sub ? ` > ${sub}` : ""}`;

  return (
    <section className={`${styles.card} ${styles.pad} ${styles.stack}`} aria-label="Upload a master file" style={{ marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Upload a master file</h2>
      <p className={styles.small} style={{ margin: 0 }}>
        The client&apos;s mapping file for the whole group (.xlsx or .csv with Code, Name, P&amp;L Mapping 1, P&amp;L Mapping 2 and
        BS Mapping). Each company&apos;s accounts are matched on code and name, and the headings are read through the pack
        template. You see every change first; nothing is saved until you apply it.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "default" : "pointer" }}>
          <FileUp size={15} aria-hidden="true" />{file ? "Choose another file" : "Choose the file"}
          <input type="file" accept=".xlsx,.xlsm,.csv" disabled={busy} style={{ display: "none" }}
            onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={approve} disabled={busy}
            onChange={(e) => { setApprove(e.target.checked); setPlan(null); setFile(null); }} />
          Approve as I apply (CFO)
        </label>
        {busy && <span className={styles.small} role="status">Working...</span>}
      </div>

      {msg && (
        <div className={msg.ok ? styles.small : styles.error} role={msg.ok ? "status" : "alert"}>
          {msg.text}
          {msg.list && <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{msg.list.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </div>
      )}

      {plan && (
        <div className={styles.stack}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>{plan.fileName}</strong>: {plan.rows.toLocaleString("en-GB")} rows read.{" "}
            {total ? `${total.toLocaleString("en-GB")} change(s) across the companies.` : "Nothing to change: every matched account already agrees."}
          </p>
          <Issues title="In the file but in no company's Xero" items={plan.unmatched.map((u) => `Row ${u.row}: ${u.code ? `${u.code} ` : ""}${u.name}`)} />
          <Issues title="In the file twice, with different headings (not applied)" items={plan.duplicates.map((d) => `${d.code} ${d.name}: rows ${d.rows.join(" and ")}`)} />

          {plan.entities.map((e) => (
            <div key={e.slug} className={styles.stack} style={{ borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                {e.name}: {e.changes.length.toLocaleString("en-GB")} change(s), {e.unchanged.toLocaleString("en-GB")} already right
              </h3>
              {e.changes.length > 0 && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {e.changes.map((c) => {
                    const k = `${e.slug}:${c.accountId}`;
                    return (
                      <li key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                        <input type="checkbox" checked={!excluded.has(k)} disabled={busy} onChange={() => toggle(k)} style={{ marginTop: 3 }}
                          aria-label={`Apply ${c.code ?? ""} ${c.name}`} />
                        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span><strong>{c.code ? `${c.code} ` : ""}{c.name}</strong> <span className={styles.small}>{KIND[c.kind]}</span></span>
                          <span className={styles.small} style={{ overflowWrap: "anywhere" }}>
                            {c.from ? `${lineOf(c.from.category, c.from.subline)}${c.from.status === "approved" ? "" : " (not approved)"}` : "Nothing saved"}
                            {" -> "}{lineOf(c.to.category, c.to.subline)}
                            {" "}(file: {c.heading}, row {c.row})
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Issues title="Same code, different name in Xero (not applied)" items={e.nameDiffers.map((x) => `${x.code}: Xero "${x.xeroName}", file "${x.masterName}"`)} />
              <Issues title="No heading in the file" items={e.noHeading.map((x) => `Row ${x.row}: ${x.code ? `${x.code} ` : ""}${x.name} (${x.statement === "pnl" ? "P&L Mapping 1" : "BS Mapping"} blank)`)} />
              <Issues title="Heading the template does not know" items={e.unknownHeading.map((x) => `Row ${x.row}: ${x.code ? `${x.code} ` : ""}${x.name}: "${x.heading}"${x.why ? ` (${x.why})` : ""}`)} />
              <Issues title="Active in Xero, not in the file" items={e.notInMaster.map((x) => `${x.code ? `${x.code} ` : ""}${x.name}`)} />
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" disabled={busy || chosen === 0} onClick={apply}>
              {approve ? "Apply and approve" : "Apply, not approved"} ({chosen.toLocaleString("en-GB")})
            </button>
            <button type="button" className="btn-text" disabled={busy} onClick={() => { setPlan(null); setFile(null); setMsg(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

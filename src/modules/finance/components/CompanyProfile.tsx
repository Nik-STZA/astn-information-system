"use client";

// The group and its companies on a client's set-up: who owns whom, each
// company's registration, country, VAT position and reporting standard, and
// the group's VAT registration. Agents read the same record before choosing a
// treatment (get_client_profile), so the gaps are shown, not hidden.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, ChevronRight, Plus } from "lucide-react";
import { FRAMEWORKS, type ClientProfile, type Company } from "@/modules/finance/lib/clients";
import styles from "./Page.module.css";

const input: React.CSSProperties = { height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)", font: "400 13px var(--font-sans)", width: "100%", boxSizing: "border-box" };
const fieldBox: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12 };

type Draft = {
  name: string; legal_name: string; company_number: string; registered_address: string; country_of_incorporation: string;
  parent_id: string; ownership_pct: string; reporting_framework: string; vat_number: string; in_vat_group: boolean; year_end: string;
};

const toDraft = (c: Company | null, parentId: string | null): Draft => ({
  name: c?.name ?? "", legal_name: c?.legal_name ?? "", company_number: c?.company_number ?? "",
  registered_address: c?.registered_address ?? "", country_of_incorporation: c?.country_of_incorporation ?? "",
  parent_id: c ? c.parent_id ?? "" : parentId ?? "", ownership_pct: c?.ownership_pct == null ? "" : String(Number(c.ownership_pct)),
  reporting_framework: c?.reporting_framework ?? "", vat_number: c?.vat_number ?? "", in_vat_group: c?.in_vat_group ?? false,
  year_end: c?.year_end ?? "",
});

// Only the fields that differ from what is saved, so the history says what changed.
function changes(d: Draft, c: Company | null): Record<string, unknown> {
  const before = toDraft(c, null);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(d) as Array<keyof Draft>) {
    if (c && d[k] === before[k]) continue;
    if (!c && (d[k] === "" || d[k] === false)) continue;
    out[k] = typeof d[k] === "boolean" ? d[k] : (d[k] as string).trim() === "" ? null : (d[k] as string).trim();
  }
  return out;
}

// The companies below one, so a company cannot be put under its own subsidiary.
function below(id: string, companies: Company[]): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => companies.filter((c) => c.parent_id === pid).forEach((c) => { out.add(c.id); walk(c.id); });
  walk(id);
  return out;
}

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return b.issues?.join(" ") ?? b.error ?? "Could not save";
}

function CompanyForm({ company, companies, vatGroup, busy, onSave, onCancel }: {
  company: Company | null;
  companies: Company[];
  vatGroup: boolean;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const top = companies.find((c) => !c.parent_id) ?? null;
  const [d, setD] = useState<Draft>(toDraft(company, company ? null : top?.id ?? null));
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setD({ ...d, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const excluded = company ? new Set([company.id, ...below(company.id, companies)]) : new Set<string>();
  const parents = companies.filter((c) => !excluded.has(c.id));
  const body = changes(d, company);
  const idp = company?.slug ?? "new";

  const text = (k: keyof Draft, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div style={fieldBox}>
      <label className={styles.small} htmlFor={`${idp}-${k}`}>{label}</label>
      <input id={`${idp}-${k}`} style={input} value={d[k] as string} onChange={set(k)} {...extra} />
    </div>
  );

  return (
    <form style={{ padding: 16, borderTop: "1px solid var(--bd)", background: "var(--pg)" }}
      onSubmit={(e) => { e.preventDefault(); if (Object.keys(body).length) onSave(body); }}>
      <div style={grid}>
        {text("name", "Name")}
        {text("legal_name", "Legal name")}
        {text("company_number", "Company registration number")}
        {text("country_of_incorporation", "Country of incorporation", { placeholder: "GB, ZA, IE", maxLength: 2, style: { ...input, textTransform: "uppercase" } })}
        <div style={fieldBox}>
          <label className={styles.small} htmlFor={`${idp}-parent`}>Owned by</label>
          <select id={`${idp}-parent`} className={styles.select} style={{ height: 34, width: "100%" }} value={d.parent_id} onChange={set("parent_id")}>
            <option value="">No parent: top of the group</option>
            {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {d.parent_id && text("ownership_pct", "Share held (%)", { inputMode: "decimal", placeholder: "100" })}
        <div style={fieldBox}>
          <label className={styles.small} htmlFor={`${idp}-framework`}>Reporting standard</label>
          <select id={`${idp}-framework`} className={styles.select} style={{ height: 34, width: "100%" }} value={d.reporting_framework} onChange={set("reporting_framework")}>
            <option value="">Not recorded</option>
            {FRAMEWORKS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        {text("year_end", "Year end", { type: "date" })}
        {!(vatGroup && d.in_vat_group) && text("vat_number", "VAT number")}
      </div>
      <div style={{ ...fieldBox, marginTop: 12 }}>
        <label className={styles.small} htmlFor={`${idp}-address`}>Registered address</label>
        <textarea id={`${idp}-address`} rows={3} value={d.registered_address} onChange={set("registered_address")}
          style={{ ...input, height: "auto", padding: "8px 10px", resize: "vertical" }} />
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13, color: vatGroup ? "var(--tx)" : "var(--sub)" }}>
        <input type="checkbox" checked={d.in_vat_group} onChange={set("in_vat_group")} disabled={!vatGroup && !d.in_vat_group} />
        In the group&apos;s VAT registration
        {!vatGroup && <span className={styles.small}>(turn on the VAT group first)</span>}
      </label>
      <div className={styles.controls} style={{ marginTop: 14 }}>
        <button type="submit" className="btn-primary" disabled={busy || !Object.keys(body).length || !d.name.trim()}>{company ? "Save company" : "Add company"}</button>
        <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function summary(c: Company, profile: ClientProfile): string {
  const parent = profile.companies.find((p) => p.id === c.parent_id);
  const vat = profile.group.vat_group && c.in_vat_group ? "VAT group" : c.vat_number ? `VAT ${c.vat_number}` : null;
  return [
    parent ? `${c.ownership_pct != null ? `${Number(c.ownership_pct)}% ` : ""}owned by ${parent.name}` : profile.companies.length > 1 ? "Group parent" : null,
    c.company_number ? `No. ${c.company_number}` : null,
    c.country_of_incorporation,
    c.reporting_framework,
    vat,
  ].filter(Boolean).join(" · ");
}

export default function CompanyProfile({ slug, profile }: { slug: string; profile: ClientProfile | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [vat, setVat] = useState({
    vat_group: profile?.group.vat_group ?? false,
    vat_group_number: profile?.group.vat_group_number ?? "",
    vat_group_representative_id: profile?.group.vat_group_representative_id ?? "",
  });

  if (!profile) {
    return (
      <section className={styles.card} aria-label="Group and companies" style={{ maxWidth: 1100, marginTop: 16 }}>
        <div className={styles.cardHead}><h2>Group and companies</h2></div>
        <div className={styles.empty}>The company profile is not set up yet. It appears here once migration 030 is applied.</div>
      </section>
    );
  }

  async function run(url: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    const err = await send(url, method, body);
    setBusy(false);
    if (err) { setError(err); return; }
    setOpen(null);
    router.refresh();
  }

  const base = `/api/clients/${slug}`;
  const vatChanged =
    vat.vat_group !== profile.group.vat_group ||
    vat.vat_group_number.trim() !== (profile.group.vat_group_number ?? "") ||
    vat.vat_group_representative_id !== (profile.group.vat_group_representative_id ?? "");

  return (
    <section className={styles.card} aria-label="Group and companies" style={{ maxWidth: 1100, marginTop: 16 }}>
      <div className={styles.cardHead}>
        <h2>Group and companies</h2>
        <span className={styles.small}>Agents read this before choosing a treatment</span>
      </div>

      {error && <div className={styles.error} role="alert" style={{ margin: 16 }}>{error}</div>}

      {profile.issues.length > 0 && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--bd)" }}>
          <div className={styles.warn} style={{ fontWeight: 600, marginBottom: 4 }}>Not recorded yet</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
            {profile.issues.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </div>
      )}

      {profile.companies.length === 0 && <div className={styles.empty}>No companies yet. Add the group&apos;s parent company first.</div>}

      {profile.companies.map((c) => (
        <div key={c.id} style={{ borderBottom: "1px solid var(--bd)" }}>
          <button type="button" onClick={() => setOpen(open === c.slug ? null : c.slug)} aria-expanded={open === c.slug}
            style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", padding: `12px 16px 12px ${16 + Math.min(c.depth, 4) * 20}px`, background: "transparent", border: 0, textAlign: "left", cursor: "pointer", color: "var(--tx)", font: "inherit" }}>
            <Building2 size={16} aria-hidden="true" style={{ flex: "0 0 16px", color: "var(--label-text)" }} />
            <span style={{ flex: "1 1 auto", minWidth: 0 }}>
              <span className={styles.rowTitle} style={{ fontSize: 14 }}>{c.name}</span>
              {c.legal_name && c.legal_name !== c.name && <span className={styles.small}> · {c.legal_name}</span>}
              <span className={styles.small} style={{ display: "block" }}>{summary(c, profile) || "No details yet"}</span>
            </span>
            {!c.connected && <span className={`${styles.status} ${styles["s-neutral"]}`}>Not in Xero</span>}
            <ChevronRight size={16} aria-hidden="true" style={{ flex: "0 0 16px", transform: open === c.slug ? "rotate(90deg)" : "none", transition: "transform 120ms" }} />
          </button>
          {open === c.slug && (
            <CompanyForm company={c} companies={profile.companies} vatGroup={profile.group.vat_group} busy={busy}
              onSave={(body) => run(`${base}/companies/${c.slug}`, "PATCH", body)} onCancel={() => setOpen(null)} />
          )}
        </div>
      ))}

      {open === "new" ? (
        <CompanyForm company={null} companies={profile.companies} vatGroup={profile.group.vat_group} busy={busy}
          onSave={(body) => run(`${base}/companies`, "POST", body)} onCancel={() => setOpen(null)} />
      ) : (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--bd)" }}>
          <button type="button" className="btn-secondary" onClick={() => setOpen("new")}>
            <Plus size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }} />Add company
          </button>
        </div>
      )}

      <div style={{ padding: 16 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={vat.vat_group} onChange={(e) => setVat({ ...vat, vat_group: e.target.checked })} />
          Registered for VAT as a group
        </label>
        <p className={styles.small} style={{ margin: "4px 0 0 24px" }}>
          Tick each member company in its details. Members file one return under the group&apos;s number.
        </p>
        {vat.vat_group && (
          <div style={{ ...grid, marginTop: 12 }}>
            <div style={fieldBox}>
              <label className={styles.small} htmlFor="vat-group-number">Group VAT number</label>
              <input id="vat-group-number" style={input} value={vat.vat_group_number} onChange={(e) => setVat({ ...vat, vat_group_number: e.target.value })} />
            </div>
            <div style={fieldBox}>
              <label className={styles.small} htmlFor="vat-group-rep">Representative member</label>
              <select id="vat-group-rep" className={styles.select} style={{ height: 34, width: "100%" }} value={vat.vat_group_representative_id}
                onChange={(e) => setVat({ ...vat, vat_group_representative_id: e.target.value })}>
                <option value="">Not recorded</option>
                {profile.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn-primary" disabled={busy || !vatChanged}
            onClick={() => run(`${base}/profile`, "PATCH", {
              vat_group: vat.vat_group,
              vat_group_number: vat.vat_group_number.trim() || null,
              vat_group_representative_id: vat.vat_group_representative_id || null,
            })}>Save VAT group</button>
        </div>
      </div>
    </section>
  );
}

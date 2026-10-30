"use client";

// Who the bill is from, and the place to change it: always on the bill, because
// a supplier that only an agent can propose has nowhere to go when it does not.
// What the document says comes from the document, so the question is asked
// whether or not an agent raised it. Creating a supplier in Xero is the CFO's
// tap; the write goes through finance-api's checks and audit, and never carries
// bank details.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./ApQueue.module.css";
import SearchSelect from "./SearchSelect";
import type { ApOptions } from "@/modules/finance/lib/ap-queue";

export interface SupplierCandidate {
  contactId: string | null;
  name: string;
  vatNumber: string | null;
  country: string | null;
  reason: string | null;
}

export default function ApSupplier({ slug, entity, itemId, editable, billName, candidate }: {
  slug: string;
  entity: string;
  itemId: string;
  editable: boolean;
  billName: string | null;
  candidate: SupplierCandidate | null;
}) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [options, setOptions] = useState<ApOptions | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const base = `/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}`;

  useEffect(() => {
    if (!changing || options) return;
    fetch(`${base}/options`).then((r) => r.json()).then((o) => { if (!o.error) setOptions(o); else setIssues([o.error]); })
      .catch(() => setIssues(["The suppliers could not be loaded"]));
  }, [changing, options, base]);

  async function put(contactId: string, name: string) {
    const res = await fetch(`${base}/items/${itemId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", note: `Supplier changed to ${name}`, edits: { contact: { ContactID: contactId, Name: name } } }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((out.issues ?? [out.error ?? `Not saved (${res.status})`]).join("; "));
    setChanging(false);
    router.refresh();
  }

  async function act(work: () => Promise<void>) {
    setBusy(true); setIssues([]);
    try { await work(); } catch (e) { setIssues([e instanceof Error ? e.message : "Not saved"]); } finally { setBusy(false); }
  }

  const useCandidate = () => act(async () => {
    const c = candidate as SupplierCandidate;
    if (c.contactId) return put(c.contactId, c.name);
    const res = await fetch(`${base}/supplier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: c.name, vat_number: c.vatNumber, country: c.country, item_id: itemId }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ContactID) throw new Error((out.issues ?? [out.error ?? `The supplier could not be created (${res.status})`]).join("; "));
    return put(out.ContactID, c.name);
  });

  const useChosen = () => act(async () => {
    const s = options?.suppliers.find((x) => x.contact_id === chosen);
    if (s) await put(s.contact_id, s.name);
  });

  return (
    <div className={styles.supplierBox}>
      <div className={styles.supplierRow}>
        <span><span className={styles.meta}>Supplier </span>{billName ?? <span className={styles.missing}>None</span>}</span>
        {editable && !changing && <button type="button" className={styles.linkButton} onClick={() => setChanging(true)}>Change</button>}
      </div>

      {candidate && (
        <div className={styles.supplierAsk}>
          <div>
            The document is from <strong>{candidate.name}</strong>
            {candidate.vatNumber ? `, VAT ${candidate.vatNumber}` : ""}{candidate.country ? `, ${candidate.country}` : ""}
            {candidate.contactId ? "." : ", which is not in Xero."}
          </div>
          {candidate.reason && <div className={styles.meta}>{candidate.reason}</div>}
          {editable && (
            <button type="button" className={styles.button} onClick={useCandidate} disabled={busy}>
              {busy ? "Working..." : candidate.contactId ? `Use ${candidate.name}` : `Create ${candidate.name} in Xero and use it`}
            </button>
          )}
        </div>
      )}

      {changing && (
        <div className={styles.supplierAsk}>
          {!options && <span className={styles.status}>Loading suppliers...</span>}
          {options && (
            <>
              <SearchSelect label="Any supplier in Xero" value={chosen} placeholder="Type to find a supplier"
                options={options.suppliers.map((s) => ({ value: s.contact_id, label: s.name }))} onChange={setChosen} />
              <div className={styles.buttonRow}>
                <button type="button" className={styles.button} onClick={useChosen} disabled={busy || !chosen}>Use this supplier</button>
                <button type="button" className={styles.buttonSecondary} onClick={() => setChanging(false)} disabled={busy}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {issues.length > 0 && <ul className={styles.issueList} role="alert">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
    </div>
  );
}

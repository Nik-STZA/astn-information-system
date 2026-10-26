"use client";

// What the CFO can do with a queue item (phase3-design.md, step 3).
//   clean or approved  Send to Xero: a dry run shows what will be created, then
//                      a confirmed send creates the bill at Awaiting approval
//                      with its document attached. Approval stays in Xero.
//   exception          choose the supplier and each line's account and VAT,
//                      then approve (it can then be sent) or reject with a reason.
// Every send names the one bill it is for: nothing is sent in bulk unseen.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./ApQueue.module.css";
import { money } from "@/modules/finance/lib/ap-labels";
import type { ApOptions, ApSendResult, ApState } from "@/modules/finance/lib/ap-queue";

export interface ApActionsItem {
  id: string;
  state: ApState;
  contactId: string | null;
  contactName: string | null;
  number: string;
  total: number | null;
  currency: string | null;
  lines: Array<{ description: string; amount: number; account: string | null; tax: string | null; accountName?: string | null; taxName?: string | null }>;
}

export default function ApActions({ slug, entity, item }: { slug: string; entity: string; item: ApActionsItem }) {
  if (item.state === "clean" || item.state === "approved") return <SendPanel slug={slug} entity={entity} item={item} />;
  if (item.state === "exception") return <DecidePanel slug={slug} entity={entity} item={item} />;
  if (item.state === "written") {
    return <p className={styles.done}>In Xero, awaiting your approval. Approve it there to make it payable.</p>;
  }
  return null;
}

function SendPanel({ slug, entity, item }: { slug: string; entity: string; item: ApActionsItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<ApSendResult | null>(null);
  const [result, setResult] = useState<ApSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoding, setRecoding] = useState(false);
  const url = `/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/items/${item.id}/send`;

  async function post(dryRun: boolean): Promise<ApSendResult> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dry_run: dryRun }) });
    const body = (await res.json().catch(() => ({}))) as ApSendResult;
    if (!res.ok && !body.issues) throw new Error(body.error ?? `The send failed (${res.status})`);
    return body;
  }

  async function dryRun() {
    setBusy(true); setError(null); setResult(null);
    try { setCheck(await post(true)); } catch (e) { setError(e instanceof Error ? e.message : "The check failed"); } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const r = await post(false);
      setResult(r);
      setCheck(null);
      if (r.validation === "PASS") router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The send failed"); } finally { setBusy(false); }
  }

  return (
    <div className={styles.actions}>
      {!check && !result && !recoding && (
        <div className={styles.buttonRow}>
          <button type="button" className={styles.button} onClick={dryRun} disabled={busy}>
            {busy ? "Checking..." : "Send to Xero"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={() => setRecoding(true)} disabled={busy}>Change coding</button>
        </div>
      )}
      {recoding && <DecidePanel slug={slug} entity={entity} item={item} recode onCancel={() => setRecoding(false)} />}

      {check?.validation === "PASS" && (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>
            This creates a bill from <strong>{item.contactName}</strong>{item.number ? `, ${item.number}` : ""}, for{" "}
            <strong>{money(item.total, item.currency)}</strong>, in Xero at <strong>Awaiting approval</strong>, with the document attached.
            You then approve it in Xero.
          </p>
          <ul className={styles.codingList}>
            {item.lines.map((l, i) => (
              <li key={i}>
                <span className={styles.lineDesc}>{l.description}</span> <strong>{money(l.amount, null)}</strong>
                <div className={styles.lineCoding}>{l.accountName ?? l.account} · {l.taxName ?? l.tax}</div>
              </li>
            ))}
          </ul>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.button} onClick={confirm} disabled={busy}>{busy ? "Sending..." : "Confirm and send"}</button>
            <button type="button" className={styles.buttonSecondary} onClick={() => setCheck(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {(check?.validation === "FAIL" || result?.validation === "FAIL") && (
        <Issues title="Xero would not take it yet" issues={(check ?? result)?.issues ?? []} onClose={() => { setCheck(null); setResult(null); }} />
      )}

      {result?.validation === "PASS" && (
        <p className={styles.done}>
          Sent: bill {result.InvoiceNumber || result.InvoiceID} is in Xero, {String(result.xero_status || "").toLowerCase().replace("submitted", "awaiting approval")}.
          {result.attached ? " The document is attached." : " The document could not be attached: attach it in Xero."}
        </p>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

// For an exception, the decision. For a clean bill (recode), the same form to
// change its coding before it is sent; saving makes it approved.
function DecidePanel({ slug, entity, item, recode = false, onCancel }: {
  slug: string; entity: string; item: ApActionsItem; recode?: boolean; onCancel?: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<ApOptions | null>(null);
  const [contactId, setContactId] = useState(item.contactId ?? "");
  const [lines, setLines] = useState(item.lines.map((l) => ({ account: l.account ?? "", tax: l.tax ?? "" })));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}`;

  useEffect(() => {
    let live = true;
    fetch(`${base}/options`).then((r) => r.json()).then((o) => { if (live && !o.error) setOptions(o); else if (live) setError(o.error); })
      .catch(() => live && setError("The accounts could not be loaded"));
    return () => { live = false; };
  }, [base]);

  async function decide(action: "approve" | "reject") {
    setBusy(true); setError(null); setIssues([]);
    const supplier = options?.suppliers.find((s) => s.contact_id === contactId);
    const body = action === "reject" ? { action, note } : {
      action, note,
      edits: {
        ...(contactId && contactId !== item.contactId ? { contact: { ContactID: contactId, Name: supplier?.name ?? null } } : {}),
        lines: lines.map((l, index) => ({ index, account_code: l.account, tax_type: l.tax })),
      },
    };
    try {
      const res = await fetch(`${base}/items/${item.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 422) { setIssues(out.issues ?? [out.error]); return; }
      if (!res.ok) throw new Error(out.error ?? `The decision failed (${res.status})`);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The decision failed"); } finally { setBusy(false); }
  }

  const ready = contactId && lines.every((l) => l.account && l.tax);

  return (
    <div className={styles.actions}>
      <h3 className={styles.sectionTitle}>{recode ? "Change coding" : "Your decision"}</h3>
      {!options && !error && <p className={styles.status}>Loading accounts...</p>}
      {options && (
        <>
          <label className={styles.field}>
            <span>Supplier</span>
            <select className={styles.select} value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Choose a supplier</option>
              {item.contactId && !options.suppliers.some((s) => s.contact_id === item.contactId) && (
                <option value={item.contactId}>{item.contactName}</option>
              )}
              {options.suppliers.map((s) => <option key={s.contact_id} value={s.contact_id}>{s.name}</option>)}
            </select>
          </label>
          {item.lines.map((l, i) => (
            <fieldset key={i} className={styles.lineEdit}>
              <legend>{l.description} · {money(l.amount, null)}</legend>
              <label className={styles.field}>
                <span>Account</span>
                <select className={styles.select} value={lines[i].account}
                  onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, account: e.target.value } : x)))}>
                  <option value="">Choose an account</option>
                  {options.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>VAT</span>
                <select className={styles.select} value={lines[i].tax}
                  onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, tax: e.target.value } : x)))}>
                  <option value="">Choose the VAT treatment</option>
                  {options.tax_types.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
                </select>
              </label>
            </fieldset>
          ))}
          <label className={styles.field}>
            <span>Note (needed to reject)</span>
            <textarea className={styles.textarea} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.button} onClick={() => decide("approve")} disabled={busy || !ready}>
              {busy ? "Saving..." : recode ? "Save coding" : "Approve"}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={() => decide("reject")} disabled={busy || !note.trim()}>
              Reject
            </button>
            {onCancel && <button type="button" className={styles.buttonSecondary} onClick={onCancel} disabled={busy}>Cancel</button>}
          </div>
          {!ready && <p className={styles.status}>Choose a supplier, and an account and VAT treatment for every line, to approve.</p>}
        </>
      )}
      {issues.length > 0 && <Issues title="Not saved" issues={issues} onClose={() => setIssues([])} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

function Issues({ title, issues, onClose }: { title: string; issues: string[]; onClose: () => void }) {
  return (
    <div className={styles.reason} role="alert">
      <div className={styles.reasonLabel}>{title}</div>
      <ul className={styles.issueList}>{issues.map((x) => <li key={x}>{x}</li>)}</ul>
      <button type="button" className={styles.linkButton} onClick={onClose}>Close</button>
    </div>
  );
}

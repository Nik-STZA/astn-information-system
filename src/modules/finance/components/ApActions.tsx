"use client";

// What the CFO can do with a queue item (phase3-design.md, step 3).
//   clean or approved  one tap, "Send GBP 1,234.00 to Xero", creates the bill
//                      (or updates Xero's draft) at Awaiting approval with its
//                      document attached. Approval stays in Xero.
//   exception          choose the supplier, due date and each line's account and
//                      VAT, then approve and send, approve only, or reject.
// Every send names the one bill it is for: nothing is sent in bulk unseen.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./ApQueue.module.css";
import SearchSelect from "./SearchSelect";
import { money, shortDate } from "@/modules/finance/lib/ap-labels";
import type { ApOptions, ApSendResult, ApState } from "@/modules/finance/lib/ap-queue";

export interface ApActionsItem {
  id: string;
  state: ApState;
  contactId: string | null;
  contactName: string | null;
  number: string;
  date: string | null;
  dueDate: string | null;
  fromDraft: boolean;
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

// One send to Xero. finance-api runs every check (supplier, accounts, VAT,
// duplicate number, the draft unchanged) before it writes, so there is no
// separate dry run: the button names the bill and its amount, and that tap is
// the confirmation (Nik, 27 Oct 2026: too many clicks). A refusal comes back
// as issues, in Xero's own words where Xero refused it.
export async function sendToXero(slug: string, entity: string, id: string): Promise<ApSendResult> {
  const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}/items/${id}/send`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dry_run: false }),
  });
  const body = (await res.json().catch(() => ({}))) as ApSendResult;
  if (body.xero_errors?.length) return { ...body, validation: "FAIL", issues: body.xero_errors };
  if (!res.ok && !body.issues) throw new Error(body.error ?? `The send failed (${res.status})`);
  return body;
}

export function sendLabel(item: ApActionsItem): string {
  return `Send ${money(item.total, item.currency)} to Xero`;
}

function SendPanel({ slug, entity, item }: { slug: string; entity: string; item: ApActionsItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoding, setRecoding] = useState(false);
  const [saved, setSaved] = useState(false);

  async function send() {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await sendToXero(slug, entity, item.id);
      setResult(r);
      if (r.validation === "PASS") router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The send failed"); } finally { setBusy(false); }
  }

  return (
    <div className={styles.actions}>
      {!result && !recoding && (
        <>
          <p className={styles.status}>
            {item.fromDraft ? "Updates Xero's draft bill" : "Creates a bill"} from {item.contactName}{item.number ? `, ${item.number}` : ""},
            due {shortDate(item.dueDate)}, at Awaiting approval with the document attached. You then approve it in Xero.
          </p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.button} onClick={send} disabled={busy}>
              {busy ? "Sending..." : sendLabel(item)}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={() => { setSaved(false); setRecoding(true); }} disabled={busy}>Change coding</button>
          </div>
        </>
      )}
      {saved && !recoding && !result && <p className={styles.done} aria-live="polite">Coding saved.</p>}
      {recoding && <DecidePanel slug={slug} entity={entity} item={item} recode onCancel={() => setRecoding(false)}
        onSaved={() => { setRecoding(false); setSaved(true); }} />}

      {result?.validation === "FAIL" && (
        <Issues title="Xero would not take it yet" issues={result.issues ?? []} onClose={() => setResult(null)} />
      )}
      {result?.validation === "PASS" && <SentNote result={result} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

export function SentNote({ result }: { result: ApSendResult }) {
  return (
    <p className={styles.done}>
      Sent: bill {result.InvoiceNumber || result.InvoiceID} is in Xero, {String(result.xero_status || "").toLowerCase().replace("submitted", "awaiting approval")}.
      {result.attached ? " The document is attached." : " The document could not be attached: attach it in Xero."}
    </p>
  );
}

// For an exception, the decision. For a clean bill (recode), the same form to
// change its coding before it is sent; saving makes it approved.
function DecidePanel({ slug, entity, item, recode = false, onCancel, onSaved }: {
  slug: string; entity: string; item: ApActionsItem; recode?: boolean; onCancel?: () => void; onSaved?: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<ApOptions | null>(null);
  const [contactId, setContactId] = useState(item.contactId ?? "");
  const [dueDate, setDueDate] = useState((item.dueDate ?? "").slice(0, 10));
  const [lines, setLines] = useState(item.lines.map((l) => ({ account: l.account ?? "", tax: l.tax ?? "" })));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [sendIssues, setSendIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/finance/${encodeURIComponent(slug)}/ap/${encodeURIComponent(entity)}`;

  useEffect(() => {
    let live = true;
    fetch(`${base}/options`).then((r) => r.json()).then((o) => { if (live && !o.error) setOptions(o); else if (live) setError(o.error); })
      .catch(() => live && setError("The accounts could not be loaded"));
    return () => { live = false; };
  }, [base]);

  // thenSend: save the decision, then send to Xero in the same tap.
  async function decide(action: "approve" | "reject", thenSend = false) {
    setBusy(true); setError(null); setIssues([]); setSendIssues([]);
    const supplier = options?.suppliers.find((s) => s.contact_id === contactId);
    const body = action === "reject" ? { action, note } : {
      action, note,
      edits: {
        ...(contactId && contactId !== item.contactId ? { contact: { ContactID: contactId, Name: supplier?.name ?? null } } : {}),
        ...(dueDate && dueDate !== (item.dueDate ?? "").slice(0, 10) ? { due_date: dueDate } : {}),
        lines: lines.map((l, index) => ({ index, account_code: l.account, tax_type: l.tax })),
      },
    };
    try {
      const res = await fetch(`${base}/items/${item.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 422) { setIssues(out.issues ?? [out.error]); return; }
      if (!res.ok) throw new Error(out.error ?? `The decision failed (${res.status})`);
      if (thenSend) {
        const sent = await sendToXero(slug, entity, item.id);
        // Saved but refused: keep the form and Xero's reasons on screen; the
        // page refreshes when they are closed.
        if (sent.validation !== "PASS") { setSendIssues(sent.issues ?? ["Xero would not take it"]); return; }
        router.refresh();
        return;
      }
      // Close the form so the saved bill above is what shows; it said nothing
      // before and looked unsaved (27 Oct 2026: saved seven times).
      onSaved?.();
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The decision failed"); } finally { setBusy(false); }
  }

  const ready = contactId && dueDate && lines.every((l) => l.account && l.tax);
  const supplierOptions = [
    ...(item.contactId && options && !options.suppliers.some((s) => s.contact_id === item.contactId)
      ? [{ value: item.contactId, label: item.contactName ?? item.contactId }] : []),
    ...(options?.suppliers ?? []).map((s) => ({ value: s.contact_id, label: s.name })),
  ];
  const accountOptions = (options?.accounts ?? []).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }));
  const taxOptions = (options?.tax_types ?? []).map((t) => ({ value: t.type, label: t.name }));

  return (
    <div className={styles.actions}>
      <h3 className={styles.sectionTitle}>{recode ? "Change coding" : "Your decision"}</h3>
      {!options && !error && <p className={styles.status}>Loading accounts...</p>}
      {options && (
        <>
          <SearchSelect label="Supplier" value={contactId} options={supplierOptions} placeholder="Type to find a supplier"
            onChange={setContactId} />
          <label className={styles.field}>
            <span>Due date{item.date ? ` (bill dated ${shortDate(item.date)})` : ""}</span>
            <input type="date" className={styles.select} value={dueDate} min={(item.date ?? "").slice(0, 10) || undefined}
              onChange={(e) => setDueDate(e.target.value)} />
          </label>
          {item.lines.map((l, i) => (
            <fieldset key={i} className={styles.lineEdit}>
              <legend>{l.description} · {money(l.amount, null)}</legend>
              <SearchSelect label="Account" value={lines[i].account} options={accountOptions}
                placeholder="Type a name or code, e.g. prepayments"
                onChange={(v) => setLines(lines.map((x, n) => (n === i ? { ...x, account: v } : x)))} />
              <SearchSelect label="VAT" value={lines[i].tax} options={taxOptions} placeholder="Type to find the VAT treatment"
                onChange={(v) => setLines(lines.map((x, n) => (n === i ? { ...x, tax: v } : x)))} />
            </fieldset>
          ))}
          <label className={styles.field}>
            <span>Note (needed to reject)</span>
            <textarea className={styles.textarea} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.button} onClick={() => decide("approve", true)} disabled={busy || !ready}>
              {busy ? "Working..." : recode ? "Save and send" : "Approve and send"}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={() => decide("approve")} disabled={busy || !ready}>
              {recode ? "Save only" : "Approve only"}
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={() => decide("reject")} disabled={busy || !note.trim()}>
              Reject
            </button>
            {onCancel && <button type="button" className={styles.buttonSecondary} onClick={onCancel} disabled={busy}>Cancel</button>}
          </div>
          {!ready && <p className={styles.status}>Choose a supplier, a due date, and an account and VAT treatment for every line, to approve.</p>}
        </>
      )}
      {issues.length > 0 && <Issues title="Not saved" issues={issues} onClose={() => setIssues([])} />}
      {sendIssues.length > 0 && (
        <Issues title="Saved, but Xero would not take it yet" issues={sendIssues} onClose={() => { setSendIssues([]); router.refresh(); }} />
      )}
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

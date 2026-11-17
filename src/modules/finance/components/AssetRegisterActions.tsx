"use client";

// What the CFO does on the asset register page:
//   a waiting line   approve it onto an asset, with its treatment and a reason,
//                    or reject it. finance-api checks the CFO and the reason.
//   a month          sign it (the button names the month: that tap is the
//                    confirmation, as with sending a bill), or reopen the
//                    latest signed month with a reason.
// Every refusal comes back in finance-api's own words.

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AssetRegister.module.css";
import { TREATMENT_LABEL, money, type WaitingLine } from "@/modules/finance/lib/asset-register";

async function call(slug: string, path: string, body: unknown): Promise<string | null> {
  const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/asset-register/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const out = (await res.json().catch(() => ({}))) as { issues?: string[]; error?: string };
  return out.issues?.join(" ") ?? out.error ?? `That did not work (${res.status})`;
}

export function WaitingLineCard({ slug, line, assets }: { slug: string; line: WaitingLine; assets: Array<{ asset_no: string; label: string }> }) {
  const router = useRouter();
  const [asset, setAsset] = useState(line.asset_no ?? "");
  const [treatment, setTreatment] = useState(line.treatment ?? "capitalise");
  const [reason, setReason] = useState(line.reason_text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(true); setError(null);
    const decision = action === "approve"
      ? { id: line.id, action, treatment, reason, ...(asset ? { asset_no: asset } : {}) }
      : { id: line.id, action, reason };
    const err = await call(slug, "cost-lines/decide", { decisions: [decision] });
    setBusy(false);
    if (err) setError(err); else router.refresh();
  }

  const needsAsset = treatment === "capitalise" && !asset;
  return (
    <div className={styles.line}>
      <div className={styles.top}>
        <span className={styles.name}>{line.supplier ?? "Journal"}{line.invoice_no ? ` ${line.invoice_no}` : ""}</span>
        <span className={styles.num}>{money(line.amount)}</span>
      </div>
      <div className={styles.meta}>
        <span>{line.company}</span><span>{line.line_date}</span>{line.posted_account_code && <span>Account {line.posted_account_code}</span>}
      </div>
      {line.question && <p className={styles.question}>{line.question}</p>}
      <div className={styles.form}>
        <label className={styles.field}><span>Treatment</span>
          <select value={treatment} onChange={(e) => setTreatment(e.target.value)} disabled={busy}>
            {Object.entries(TREATMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {treatment === "capitalise" && (
          <label className={styles.field}><span>Asset</span>
            <select value={asset} onChange={(e) => setAsset(e.target.value)} disabled={busy}>
              <option value="">Choose the asset</option>
              {assets.map((a) => <option key={a.asset_no} value={a.asset_no}>{a.label}</option>)}
            </select>
          </label>
        )}
        <label className={styles.field}><span>Reason</span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="Why, in a sentence: it goes on the record" />
        </label>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.buttons}>
        <button type="button" className="btn-primary" disabled={busy || needsAsset || reason.trim().length < 3} onClick={() => decide("approve")}>
          {treatment === "capitalise" ? `Capitalise ${money(line.amount)}${asset ? ` to ${asset}` : ""}` : `Approve: ${TREATMENT_LABEL[treatment] ?? treatment}`}
        </button>
        <button type="button" className="btn-text" disabled={busy || reason.trim().length < 3} onClick={() => decide("reject")}>Reject</button>
      </div>
    </div>
  );
}

export function MonthActions({ slug, grouping, period, monthLabel, canSign, canReopen }: {
  slug: string; grouping: string; period: string; monthLabel: string; canSign: boolean; canReopen: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  async function act(path: string, body: unknown) {
    setBusy(true); setError(null);
    const err = await call(slug, path, body);
    setBusy(false);
    if (err) setError(err); else { setReopening(false); setReason(""); router.refresh(); }
  }

  return (
    <div className={styles.monthActions}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {reopening ? (
        <div className={styles.form}>
          <label className={styles.field}><span>Why is {monthLabel} reopened?</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="At least 10 characters: it goes on the record" />
          </label>
          <div className={styles.buttons}>
            <button type="button" className="btn-secondary" disabled={busy || reason.trim().length < 10}
              onClick={() => act("periods/reopen", { grouping, period, reason })}>Reopen {monthLabel}</button>
            <button type="button" className="btn-text" disabled={busy} onClick={() => setReopening(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className={styles.buttons}>
          {canSign && <button type="button" className="btn-primary" disabled={busy} onClick={() => act("periods/sign", { grouping, period })}>Sign {monthLabel}</button>}
          {canReopen && <button type="button" className="btn-text" disabled={busy} onClick={() => setReopening(true)}>Reopen</button>}
        </div>
      )}
      {canSign && <p className={styles.hint}>Signing locks {monthLabel}: nothing dated in it can change unless it is reopened.</p>}
    </div>
  );
}

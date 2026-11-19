"use client";

// One month of accruals: what the agents proposed, discussed and decided in
// place; the schedule with each item's journal pair and the bill that cleared
// it; the precedents the agents follow; the accruals account per company; and
// the tie of that account to the schedule.
//
// Nothing here talks to Xero. A decision to accrue puts the pair on the
// Journals page, where the CFO approves it and finance-api makes two drafts.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play, Scale } from "lucide-react";
import { dayLabel, money, periodChoices, periodLong } from "@/modules/finance/lib/recs";
import {
  BASIS_LABEL, DECISION_LABEL, TEST_LABEL, decisionBody, isOpen, whoSaid,
  type AccrualMonth, type AccrualProposal, type Decision,
} from "@/modules/finance/lib/accruals";
import page from "./Page.module.css";
import styles from "./Accruals.module.css";

type Call = (path: string, body?: unknown, method?: "POST" | "PUT") => Promise<{ ok: boolean; body: Record<string, unknown> }>;

const said = (b: Record<string, unknown>, fallback: string) =>
  String((b.issues as string[] | undefined)?.join(" ") ?? b.error ?? fallback);

export default function AccrualsView({ slug, data, focus }: { slug: string; data: AccrualMonth; focus: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/finance/clients/${encodeURIComponent(slug)}`;

  const call: Call = async (path, body = {}, method = "POST") => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/${encodeURIComponent(slug)}/accruals/${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const out = { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> };
    setBusy(false);
    if (!out.ok) setError(said(out.body, "That did not work"));
    router.refresh();
    return out;
  };

  const runMonth = async () => {
    const r = await call("run", { period: data.period });
    if (!r.ok) return;
    const proposed = (r.body.proposed as Array<{ jnl: string; supplier: string; period: string; backfill: boolean }>) ?? [];
    const matched = (r.body.matched as unknown[]) ?? [];
    const findings = (r.body.findings as unknown[]) ?? [];
    setNotice(`${proposed.length ? `Proposed ${proposed.map((p) => `${p.jnl} ${p.supplier}, ${periodLong(p.period)}${p.backfill ? " (backfill)" : ""}`).join("; ")}.` : "Nothing new to propose."} ${matched.length} bill${matched.length === 1 ? "" : "s"} matched. ${findings.length} finding${findings.length === 1 ? "" : "s"}.`);
  };

  const open = data.proposals.filter(isOpen);
  const decided = data.proposals.filter((p) => !isOpen(p) && p.period === data.period);
  const noAccount = data.entities.filter((e) => !e.accrual_account);

  return (
    <div>
      <div className={styles.bar}>
        <select aria-label="Month" className={styles.pick} value={data.period}
          onChange={(e) => router.push(`${base}/accruals?period=${e.target.value}`)}>
          {periodChoices(data.period).map((p) => <option key={p} value={p}>{periodLong(p)}</option>)}
        </select>
        <button type="button" className="btn-primary" disabled={busy} onClick={runMonth}><Play size={14} aria-hidden="true" />Run the month</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => router.push(`${base}/accruals?period=${data.period}&tie=1`)}>
          <Scale size={14} aria-hidden="true" />Tie to Xero
        </button>
        <Link className={page.miniBtn} href={`${base}/journals?period=${data.period}`}>Journals{data.counts.pairs_waiting ? ` (${data.counts.pairs_waiting} pair${data.counts.pairs_waiting === 1 ? "" : "s"} waiting)` : ""}</Link>
      </div>

      {error && <div className={page.error} role="alert">{error}</div>}
      {notice && <div className={`${page.card} ${page.pad}`} role="status">{notice}</div>}

      {noAccount.length > 0 && (
        <div className={`${page.card} ${page.pad} ${styles.warn}`} role="status">
          No accruals account is set for {noAccount.map((e) => e.name).join(", ")}, so nothing is proposed for {noAccount.length === 1 ? "it" : "them"}. Set it under Accruals accounts below.
        </div>
      )}

      {data.findings.length > 0 && (
        <section className={styles.section} aria-labelledby="findings">
          <h2 id="findings" className={styles.h2}>Findings <span className={styles.count}>{data.findings.length}</span></h2>
          <div className={`${page.card} ${page.pad} ${page.stack}`}>
            {data.findings.map((f, i) => <span key={i} className={styles.warn} style={{ fontSize: 13 }}>{f.text}</span>)}
          </div>
        </section>
      )}

      {data.tie && <Tie data={data} />}

      <section className={styles.section} aria-labelledby="open">
        <h2 id="open" className={styles.h2}>To discuss and decide <span className={styles.count}>{open.length}</span></h2>
        {open.length === 0 ? (
          <div className={`${page.card} ${page.empty}`}>Nothing waiting. Ask FM1 to run the accruals for {periodLong(data.period)}, or run the month above for the standing items.</div>
        ) : (
          <div className={page.stack}>
            {open.map((p) => <Proposal key={p.id} p={p} busy={busy} call={call} focused={focus === p.id} />)}
          </div>
        )}
      </section>

      <Schedule data={data} base={base} busy={busy} call={call} />

      {decided.length > 0 && (
        <section className={styles.section} aria-labelledby="decided">
          <h2 id="decided" className={styles.h2}>Decided this month <span className={styles.count}>{decided.length}</span></h2>
          <div className={page.stack}>
            {decided.map((p) => <Proposal key={p.id} p={p} busy={busy} call={call} focused={focus === p.id} />)}
          </div>
        </section>
      )}

      <Precedents data={data} busy={busy} call={call} setNotice={setNotice} />
      <Accounts data={data} busy={busy} call={call} />
    </div>
  );
}

// ── A proposal and its discussion ────────────────────────────────────────────

function Proposal({ p, busy, call, focused }: { p: AccrualProposal; busy: boolean; call: Call; focused: boolean }) {
  const [comment, setComment] = useState("");
  const [challenge, setChallenge] = useState(false);
  const live = isOpen(p);
  return (
    <details id={`p-${p.id}`} className={`${page.card} ${focused ? styles.focus : ""}`} open={live || focused}>
      <summary style={{ listStyle: "none", cursor: "pointer", padding: "12px 16px" }}>
        <div className={styles.head}>
          <span className={styles.name}>{p.supplier}</span>
          <span className={styles.num}>{p.total ? money(p.total) : "Question"}</span>
        </div>
        <div className={styles.meta}>
          <span>{p.entity_name}</span><span>{periodLong(p.period)}</span><span>{TEST_LABEL[p.test]}</span>
          <span>{p.confidence === "open" ? "Needs a fact from outside the ledger" : `${p.confidence} confidence`}</span>
          <span>from {whoSaid(p.proposed_by)}</span>
          <span className={`${page.status} ${p.decision === "pending" ? page["s-amber"] : p.decision === "question" ? page["s-blue"] : p.decision === "no_accrual" ? "" : page["s-green"]}`}>
            {DECISION_LABEL[p.decision]}
          </span>
        </div>
      </summary>
      <div className={styles.body}>
        <div>
          <div className={styles.label}>Basis: {BASIS_LABEL[p.basis_kind]}</div>
          {p.basis}
          {(p.service_from || p.service_to) && <div className={styles.meta}>Service {p.service_from ? dayLabel(p.service_from) : "?"} to {p.service_to ? dayLabel(p.service_to) : "?"}</div>}
        </div>
        {p.lines.length > 0 && (
          <div>
            <div className={styles.label}>Accrual, net of VAT</div>
            {p.lines.map((l, i) => <div key={i} className={styles.line}><span>{l.account_code}{l.description ? ` ${l.description}` : ""}</span><span className={styles.num}>{money(l.amount)}</span></div>)}
          </div>
        )}
        {p.evidence.length > 0 && (
          <div><div className={styles.label}>Evidence</div>{p.evidence.map((e, i) => <div key={i} className={styles.meta}>{Object.values(e).filter(Boolean).join(", ")}</div>)}</div>
        )}
        {(p.cited.length > 0 || p.departs_reason) && (
          <div>
            <div className={styles.label}>Precedent</div>
            {p.cited.map((c) => <div key={c.id}>Follows {periodLong(c.period)}: {DECISION_LABEL[c.decision as Decision] ?? c.decision}{c.reason ? `, ${c.reason}` : ""}</div>)}
            {p.departs_reason && <div>Differs this month: {p.departs_reason}</div>}
          </div>
        )}

        <div>
          <div className={styles.label}>Discussion</div>
          {p.comments.length === 0 ? <span className={styles.meta}>No comments yet.</span> : (
            <div className={styles.thread}>
              {p.comments.map((c) => (
                <div key={c.id} className={`${styles.comment} ${c.challenge ? styles.challenge : ""}`}>
                  <span className={styles.who}>{whoSaid(c.author)}{c.challenge ? " (challenge)" : ""}</span>
                  <span className={styles.when}>{dayLabel(c.created_at)}</span>
                  <div>{c.body}</div>
                </div>
              ))}
            </div>
          )}
          <div className={styles.row} style={{ marginTop: 8 }}>
            <textarea className={styles.area} aria-label={`Comment on ${p.supplier}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ask, answer, or note a fact. The agents read this before next month." />
            <label className={styles.meta}><input type="checkbox" checked={challenge} onChange={(e) => setChallenge(e.target.checked)} /> Mark as a challenge</label>
            <button type="button" className="btn-secondary" disabled={busy || !comment.trim()}
              onClick={async () => { const r = await call(`proposals/${p.id}/comments`, { body: comment.trim(), challenge }); if (r.ok) { setComment(""); setChallenge(false); } }}>
              Comment
            </button>
          </div>
        </div>

        {live ? <Decide p={p} busy={busy} call={call} /> : (
          <div className={styles.meta}>
            {DECISION_LABEL[p.decision]}{p.decision_reason ? `: ${p.decision_reason}` : ""}{p.decided_by ? ` (${p.decided_by}, ${dayLabel(p.decided_at)}` : ""}{p.decided_by ? `${p.applies_to === "until_changed" ? ", until changed" : ", this month only"})` : ""}
          </div>
        )}
      </div>
    </details>
  );
}

function Decide({ p, busy, call }: { p: AccrualProposal; busy: boolean; call: Call }) {
  const [decision, setDecision] = useState<Exclude<Decision, "pending" | "superseded"> | null>(null);
  const [reason, setReason] = useState("");
  const [appliesTo, setAppliesTo] = useState<"this_month" | "until_changed">("this_month");
  const [lines, setLines] = useState(p.lines.length ? p.lines.map((l) => ({ account_code: l.account_code, amount: String(l.amount) })) : [{ account_code: "", amount: "" }]);
  const [endPeriod, setEndPeriod] = useState("");
  const [lag, setLag] = useState(1);
  const [issue, setIssue] = useState<string | null>(null);
  const hasAmount = p.lines.length > 0;
  const choices: Array<{ key: Exclude<Decision, "pending" | "superseded">; label: string; show: boolean }> = [
    { key: "accept", label: "Accrue", show: hasAmount },
    { key: "accept_edited", label: hasAmount ? "Accrue a different amount" : "Accrue an amount", show: true },
    { key: "standing", label: "Accrue every month", show: hasAmount },
    { key: "no_accrual", label: "No accrual", show: true },
    { key: "question", label: "Ask back", show: true },
  ];
  const send = async () => {
    if (!decision) return;
    const d = decisionBody({ decision, reason, appliesTo, lines, endPeriod: endPeriod || undefined, lag: decision === "standing" ? lag : undefined });
    setIssue(d.issue);
    if (!d.body) return;
    await call(`proposals/${p.id}/decide`, d.body);
  };
  return (
    <div className={styles.decide}>
      <div className={styles.label}>Your decision</div>
      <div className={styles.row} role="radiogroup" aria-label="Decision">
        {choices.filter((c) => c.show).map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={decision === c.key} className={decision === c.key ? "btn-primary" : "btn-secondary"} onClick={() => setDecision(c.key)}>{c.label}</button>
        ))}
      </div>
      {decision === "accept_edited" && lines.map((l, i) => (
        <div key={i} className={styles.row}>
          <input className={styles.input} style={{ maxWidth: 120 }} aria-label="Account" value={l.account_code} placeholder="Account" onChange={(e) => setLines((ls) => ls.map((x, n) => (n === i ? { ...x, account_code: e.target.value } : x)))} />
          <input className={styles.input} style={{ maxWidth: 160 }} aria-label="Amount, net of VAT" inputMode="decimal" value={l.amount} placeholder="Net of VAT" onChange={(e) => setLines((ls) => ls.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))} />
        </div>
      ))}
      {decision === "standing" && (
        <div className={styles.row}>
          <label className={styles.meta}>Last month (optional) <input type="month" className={styles.input} value={endPeriod} onChange={(e) => setEndPeriod(e.target.value)} /></label>
          <label className={styles.meta}>Billed
            <select className={styles.input} value={lag} onChange={(e) => setLag(Number(e.target.value))}>
              <option value={0}>in the month</option><option value={1}>the month after</option><option value={2}>two months after</option><option value={3}>three months after</option>
            </select>
          </label>
        </div>
      )}
      {decision && (
        <>
          <textarea className={styles.area} aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={decision === "question" ? "Your question for the agent" : decision === "no_accrual" ? "Why not: the agents follow this" : "Why (optional): the agents read it"} />
          {decision !== "question" && (
            <div className="seg" role="radiogroup" aria-label="Applies">
              <button type="button" role="radio" aria-checked={appliesTo === "this_month"} className={appliesTo === "this_month" ? "seg-on" : ""} onClick={() => setAppliesTo("this_month")}>This month only</button>
              <button type="button" role="radio" aria-checked={appliesTo === "until_changed"} className={appliesTo === "until_changed" ? "seg-on" : ""} onClick={() => setAppliesTo("until_changed")}>Until I change it</button>
            </div>
          )}
          {issue && <span className={styles.err}>{issue}</span>}
          <div className={styles.row}>
            <button type="button" className="btn-primary" disabled={busy} onClick={send}>{decision === "question" ? "Send the question" : "Decide"}</button>
            <span className={styles.meta}>{["accept", "accept_edited", "standing"].includes(decision) ? "The accrual and its reversal go to the Journals page for your approval." : "Kept as a precedent the agents follow."}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── The schedule ─────────────────────────────────────────────────────────────

const PAIR_STATE: Record<string, string> = {
  proposed: "waiting for approval", approved: "approved, going to Xero", draft_created: "drafts in Xero", posted: "posted", rejected: "rejected",
};

function Schedule({ data, base, busy, call }: { data: AccrualMonth; base: string; busy: boolean; call: Call }) {
  const [stopping, setStopping] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (!data.items.length && !data.due.length) return null;
  const next = (p: string) => { const [y, m] = p.split("-").map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  return (
    <section className={styles.section} aria-labelledby="schedule">
      <h2 id="schedule" className={styles.h2}>Schedule for {periodLong(data.period)} <span className={styles.count}>{data.items.length}</span></h2>
      {data.due.length > 0 && <p className={page.small}>Due and not yet proposed: {data.due.map((d) => `${d.supplier}, ${periodLong(d.period)}${d.backfill ? " (backfill)" : ""}`).join("; ")}. Run the month to propose them.</p>}
      <div className={`${page.card} ${styles.tableWrap}`}>
        <table className={styles.table}>
          <thead><tr><th>Supplier</th><th className={styles.hidePhone}>Company</th><th className={styles.num}>Accrued</th><th>Pair</th><th>Bill</th><th aria-label="Actions"></th></tr></thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <td>{i.supplier}<div className={styles.meta}>{i.standing ? `Every month from ${periodLong(i.period_from)}${i.end_period ? ` to ${periodLong(i.end_period)}` : ""}${i.stopped_period ? `, stopped from ${periodLong(i.stopped_period)}` : ""}` : "One month"}</div></td>
                <td className={styles.hidePhone}>{i.entity_name}</td>
                <td className={styles.num}>{i.accrues ? money(i.amount) : "-"}</td>
                <td>{i.pair ? <Link className={styles.link} href={`${base}/journals?period=${data.period}`}>{i.pair.jnl ?? "Pair"}</Link> : "Not proposed"}<div className={styles.meta}>{i.pair ? PAIR_STATE[i.pair.state] ?? i.pair.state : ""}</div></td>
                <td>{i.cleared ? <>{i.cleared.bill_number ?? "Bill"}, {dayLabel(i.cleared.bill_date)}<div className={styles.meta}>{money(i.cleared.bill_net)}, difference {money(i.cleared.difference)}</div></> : <span className={styles.meta}>Not yet</span>}</td>
                <td>
                  {i.standing && !i.stopped_period && (stopping === i.id ? (
                    <div className={page.stack}>
                      <input className={styles.input} aria-label="Why it stops" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it stops" />
                      <div className={styles.row}>
                        <button type="button" className="btn-secondary" disabled={busy || !reason.trim()} onClick={async () => { const r = await call(`items/${i.id}/stop`, { period: next(data.period), reason: reason.trim() }); if (r.ok) { setStopping(null); setReason(""); } }}>
                          Stop from {periodLong(next(data.period))}
                        </button>
                        <button type="button" className="btn-text" onClick={() => setStopping(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : <button type="button" className="btn-text" disabled={busy} onClick={() => setStopping(i.id)}>Stop</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── The tie ──────────────────────────────────────────────────────────────────

function Tie({ data }: { data: AccrualMonth }) {
  const t = data.tie!;
  return (
    <section className={styles.section} aria-labelledby="tie">
      <h2 id="tie" className={styles.h2}>Accruals account against the schedule, {periodLong(data.period)} <span className={`${page.status} ${t.ties ? page["s-green"] : page["s-amber"]}`}>{t.ties ? "Ties" : "Does not tie"}</span></h2>
      <div className={`${page.card} ${styles.tableWrap}`}>
        <table className={styles.table}>
          <thead><tr><th>Company</th><th className={styles.num}>Ledger</th><th className={styles.num}>Schedule</th><th className={styles.num}>Difference</th></tr></thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.entity_id}>
                <td>{r.entity_name} {r.account_code}{r.note && <div className={styles.meta}>{r.note}</div>}</td>
                <td className={styles.num}>{money(r.ledger / 100)}</td><td className={styles.num}>{money(r.schedule / 100)}</td>
                <td className={styles.num}>{r.variance === 0 ? "-" : money(r.variance / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.unread.length > 0 && <p className={page.small}>Not read from Xero: {t.unread.join("; ")}</p>}
    </section>
  );
}

// ── Precedents and accounts ──────────────────────────────────────────────────

function Precedents({ data, busy, call, setNotice }: { data: AccrualMonth; busy: boolean; call: Call; setNotice: (s: string) => void }) {
  if (!data.precedents.length) return null;
  return (
    <section className={styles.section} aria-labelledby="precedents">
      <h2 id="precedents" className={styles.h2}>Precedents the agents follow <span className={styles.count}>{data.precedents.length}</span></h2>
      <div className={page.stack}>
        {data.precedents.map((p) => (
          <div key={p.id} className={`${page.card} ${page.pad}`}>
            <div className={styles.head}>
              <span className={styles.name}>{p.supplier}</span>
              <span className={styles.meta}>{p.applies_to === "until_changed" ? `From ${periodLong(p.period)}, until changed` : `${periodLong(p.period)} only`}</span>
            </div>
            <div className={styles.meta}><span>{p.entity_name}</span><span>{DECISION_LABEL[p.decision as Decision] ?? p.decision}</span><span>{dayLabel(p.decided_at)}</span></div>
            {p.reason && <div style={{ fontSize: 13, marginTop: 6 }}>{p.reason}</div>}
            <div className={styles.row} style={{ marginTop: 8 }}>
              {p.applies_to === "until_changed" && <button type="button" className="btn-text" disabled={busy} onClick={() => call(`precedents/${p.id}/end`)}>End it</button>}
              {!p.promoted_rule_id && (
                <button type="button" className="btn-text" disabled={busy}
                  onClick={async () => { const r = await call(`precedents/${p.id}/promote`); if (r.ok) setNotice(String(r.body.note ?? "Drafted on the Procedures page.")); }}>
                  Make it a client rule
                </button>
              )}
              {p.promoted_rule_id && <span className={styles.meta}>In the client&apos;s rules</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Accounts({ data, busy, call }: { data: AccrualMonth; busy: boolean; call: Call }) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  return (
    <section className={styles.section} aria-labelledby="accounts">
      <h2 id="accounts" className={styles.h2}>Accruals accounts</h2>
      <div className={`${page.card} ${page.pad} ${page.stack}`}>
        <span className={page.small}>Each company&apos;s own accruals account. Accruals are credited here and reversed from here; nothing uses a code that is not set.</span>
        {data.entities.map((e) => (
          <div key={e.id} className={styles.row}>
            <span style={{ minWidth: 180, fontSize: 13 }}>{e.name}</span>
            <span className={styles.meta}>{e.accrual_account ? `${e.accrual_account}${e.account_set ? "" : " (from the Accruals line)"}` : "Not set"}</span>
            <input className={styles.input} style={{ maxWidth: 100 }} aria-label={`Accruals account for ${e.name}`} placeholder="Code" value={codes[e.slug] ?? ""}
              onChange={(ev) => setCodes((c) => ({ ...c, [e.slug]: ev.target.value }))} />
            <button type="button" className="btn-text" disabled={busy || !(codes[e.slug] ?? "").trim()}
              onClick={async () => { const r = await call("settings", { entity: e.slug, account_code: codes[e.slug].trim() }, "PUT"); if (r.ok) setCodes((c) => ({ ...c, [e.slug]: "" })); }}>
              Set
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

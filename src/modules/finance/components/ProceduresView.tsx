"use client";

// The Procedures page: the list of procedures, and one procedure opened with
// its standard text, this client's rules for it and what an agent reads
// today. People write a rule as a draft and approve it here; changing an
// approved rule sends it back for approval (finance-api lib/procedure-rules.js).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Plus } from "lucide-react";
import MarkdownOutput from "@/modules/finance/components/MarkdownOutput";
import {
  KIND_LABEL, STATUS_LABEL, STATUS_PILL, liveRules, ownProcedures, procedureName, ruleNote,
  type ClientRule, type ProcedureDetail, type ProcedureList, type RuleKind,
} from "@/modules/finance/lib/procedures";
import styles from "./Page.module.css";

const input: React.CSSProperties = { height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--pnl)", color: "var(--tx)", font: "400 13px var(--font-sans)", width: "100%", boxSizing: "border-box" };
const area: React.CSSProperties = { ...input, height: "auto", minHeight: 160, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 };
const fieldBox: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
const rowLink: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--bd)", color: "var(--tx)", textDecoration: "none" };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return b.issues?.join(" ") ?? b.error ?? "Could not save";
}

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, method: string, body: unknown, after?: () => void) {
    setBusy(true);
    setError(null);
    const err = await send(url, method, body);
    setBusy(false);
    if (err) { setError(err); return false; }
    after?.();
    router.refresh();
    return true;
  }
  return { busy, error, run };
}

function Row({ href, title, summary, side, pill }: { href: string; title: string; summary?: string | null; side?: string; pill?: { text: string; pill: string } | null }) {
  return (
    <Link href={href} style={rowLink}>
      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        <span className={styles.rowTitle} style={{ fontSize: 14 }}>{title}</span>
        {summary && <span className={styles.small} style={{ display: "block", marginTop: 2 }}>{summary}</span>}
        {side && <span className={styles.small} style={{ display: "block", marginTop: 2 }}>{side}</span>}
      </span>
      {pill && <span className={`${styles.status} ${styles[pill.pill]}`} style={{ flex: "0 0 auto" }}>{pill.text}</span>}
      <ChevronRight size={16} aria-hidden="true" style={{ flex: "0 0 16px", color: "var(--sub)" }} />
    </Link>
  );
}

function RoleTicks({ roles, value, onChange }: { roles: ProcedureList["roles"]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className={styles.small} style={{ marginBottom: 4 }}>Which agents use it</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
        {roles.map((r) => (
          <label key={r.name} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={value.includes(r.name)}
              onChange={(e) => onChange(e.target.checked ? [...value, r.name] : value.filter((x) => x !== r.name))} />
            {r.title}
          </label>
        ))}
      </div>
      <span className={styles.small}>None ticked: every agent can open it.</span>
    </fieldset>
  );
}

// A new rule, or a change to one.
function RuleForm({ rule, kinds, roles, own, busy, onSave, onCancel }: {
  rule: ClientRule | null;
  kinds: RuleKind[];
  roles: ProcedureList["roles"];
  own: boolean;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? kinds[0]);
  const [title, setTitle] = useState(rule?.title ?? "");
  const [summary, setSummary] = useState(rule?.summary ?? "");
  const [body, setBody] = useState(rule?.body ?? "");
  const [picked, setPicked] = useState<string[]>(rule?.roles ?? []);
  const name = procedureName(title);
  const ready = body.trim() && (!own || title.trim());

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const out: Record<string, unknown> = { body };
    if (own) Object.assign(out, { title, summary, roles: picked });
    if (!rule) Object.assign(out, { kind: own ? "own" : kind, ...(own ? { procedure: name } : {}) });
    onSave(out);
  }

  return (
    <form onSubmit={submit} style={{ padding: 16, borderTop: "1px solid var(--bd)", background: "var(--pg)", display: "flex", flexDirection: "column", gap: 12 }}>
      {!rule && !own && kinds.length > 1 && (
        <div className="seg" role="radiogroup" aria-label="What the rule does">
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "seg-on" : ""} onClick={() => setKind(k)}>
              {k === "addition" ? "Add to the standard" : "Replace for this client"}
            </button>
          ))}
        </div>
      )}
      {own && (
        <>
          <div style={fieldBox}>
            <label className={styles.small} htmlFor="rule-title">Title</label>
            <input id="rule-title" style={input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Stock count" />
            {!rule && name && <span className={styles.small}>Agents open it as {name}</span>}
          </div>
          <div style={fieldBox}>
            <label className={styles.small} htmlFor="rule-summary">One line on what it covers</label>
            <input id="rule-summary" style={input} value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <RoleTicks roles={roles} value={picked} onChange={setPicked} />
        </>
      )}
      <div style={fieldBox}>
        <label className={styles.small} htmlFor="rule-body">
          {own ? "The procedure" : kind === "replacement" ? "This client's version, in full" : "The rules to add"}
        </label>
        <textarea id="rule-body" style={area} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)}
          placeholder={kind === "addition" && !own ? "Accrue freelancers monthly from the time sheet, not on invoice." : ""} />
        <span className={styles.small}>Markdown: # headings, - lists, **bold**. Name accounts by their name in Xero, not their code.</span>
      </div>
      {rule?.status === "approved" && (
        <p className={styles.warn} style={{ margin: 0, fontSize: 13 }}>
          Saving a change takes this rule away from the agents until it is approved again.
        </p>
      )}
      <div className={styles.controls}>
        <button type="submit" className="btn-primary" disabled={busy || !ready}>{rule ? "Save change" : "Save as draft"}</button>
        <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function RuleCard({ rule, slug, roles, own, busy, run }: {
  rule: ClientRule; slug: string; roles: ProcedureList["roles"]; own: boolean; busy: boolean;
  run: ReturnType<typeof useRun>["run"];
}) {
  const [editing, setEditing] = useState(false);
  const base = `/api/clients/${slug}/procedure-rules/${rule.id}`;
  const who = rule.status === "approved" && rule.approved_by
    ? `Approved by ${rule.approved_by} on ${day(rule.approved_at!)}`
    : `Written by ${rule.created_by}, ${day(rule.updated_at)}`;
  const roleNames = (rule.roles ?? []).map((r) => roles.find((x) => x.name === r)?.title ?? r);

  return (
    <div style={{ borderBottom: "1px solid var(--bd)" }}>
      <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span className={styles.rowTitle} style={{ fontSize: 14, flex: "1 1 200px" }}>
          {KIND_LABEL[rule.kind]} · version {rule.version}
        </span>
        <span className={`${styles.status} ${styles[STATUS_PILL[rule.status]]}`}>{STATUS_LABEL[rule.status]}</span>
        <span className={styles.small} style={{ flexBasis: "100%" }}>
          {who}{own && roleNames.length ? ` · for ${roleNames.join(", ")}` : ""}
        </span>
      </div>
      {!editing && (
        <div style={{ padding: "0 16px 12px", fontSize: 13 }}>
          <MarkdownOutput text={rule.body} />
          {rule.status !== "retired" && (
            <div className={styles.controls} style={{ marginTop: 10 }}>
              {rule.status === "draft" && (
                <button type="button" className="btn-primary" disabled={busy} onClick={() => run(`${base}/approve`, "POST", {})}>Approve for the agents</button>
              )}
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(true)}>Change</button>
              <button type="button" className="btn-text" disabled={busy} onClick={() => run(`${base}/retire`, "POST", {})}>Retire</button>
            </div>
          )}
        </div>
      )}
      {editing && (
        <RuleForm rule={rule} kinds={[rule.kind]} roles={roles} own={own} busy={busy}
          onSave={(body) => run(base, "PATCH", body, () => setEditing(false))} onCancel={() => setEditing(false)} />
      )}
    </div>
  );
}

function Detail({ slug, list, detail }: { slug: string; list: ProcedureList; detail: ProcedureDetail }) {
  const { busy, error, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const std = detail.standard;
  const own = !std;
  const live = liveRules(detail.rules);
  const retired = detail.rules.filter((r) => r.status === "retired");
  const taken = new Set(live.map((r) => r.kind));
  const kinds: RuleKind[] = own
    ? (taken.has("own") ? [] : ["own"])
    : (["addition", "replacement"] as RuleKind[]).filter((k) => !taken.has(k) && !(k === "replacement" && std?.always_loaded));
  const roleTitle = (n: string) => list.roles.find((r) => r.name === n)?.title ?? n;
  const title = std?.title ?? detail.rules[0]?.title ?? detail.name;

  return (
    <>
      <Link href="?" className={styles.small} style={{ display: "inline-flex", gap: 4, alignItems: "center", marginBottom: 12, color: "var(--sub)", textDecoration: "none" }}>
        <ChevronLeft size={14} aria-hidden="true" />All procedures
      </Link>

      <section className={styles.card} style={{ maxWidth: 900 }} aria-label={title}>
        <div className={styles.cardHead} style={{ flexWrap: "wrap", gap: 8 }}>
          <h2>{title}</h2>
          <span className={styles.small}>
            {std ? `Standard version ${std.version}` : "This client's own"}
            {std && ` · ${std.always_loaded ? "every agent, always loaded" : std.roles.map(roleTitle).join(", ")}`}
          </span>
        </div>
        {(std?.summary || (own && detail.rules[0]?.summary)) && (
          <p style={{ margin: 0, padding: "12px 16px", fontSize: 13, borderBottom: "1px solid var(--bd)" }}>{std?.summary ?? detail.rules[0]?.summary}</p>
        )}
        {std?.always_loaded && (
          <p className={styles.small} style={{ margin: 0, padding: "10px 16px", display: "flex", gap: 6, alignItems: "center", borderBottom: "1px solid var(--bd)" }}>
            <Lock size={13} aria-hidden="true" />A client&apos;s rules may tighten this procedure, never set it aside, so it can be added to but not replaced.
          </p>
        )}
      </section>

      <section className={styles.card} style={{ maxWidth: 900, marginTop: 16 }} aria-label="This client's rules">
        <div className={styles.cardHead}>
          <h2>{own ? "The procedure" : "This client's rules"}</h2>
          <span className={styles.small}>Only approved rules reach the agents</span>
        </div>
        {error && <div className={styles.error} role="alert" style={{ margin: 16 }}>{error}</div>}
        {!live.length && !adding && (
          <div className={styles.empty}>{own ? "Nothing live: every version has been retired." : "None. The agents follow the standard text below."}</div>
        )}
        {live.map((r) => <RuleCard key={r.id} rule={r} slug={slug} roles={list.roles} own={own} busy={busy} run={run} />)}
        {adding ? (
          <RuleForm rule={null} kinds={kinds} roles={list.roles} own={own} busy={busy}
            onSave={(body) => run(`/api/clients/${slug}/procedure-rules`, "POST", { procedure: detail.name, ...body }, () => setAdding(false))}
            onCancel={() => setAdding(false)} />
        ) : kinds.length > 0 && (
          <div style={{ padding: "12px 16px" }}>
            <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }} />
              {own ? "Write a new version" : live.length ? "Add another kind of rule" : "Add a rule for this client"}
            </button>
          </div>
        )}
        {retired.length > 0 && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--bd)" }}>
            <button type="button" className="btn-text" onClick={() => setShowRetired(!showRetired)} aria-expanded={showRetired}>
              {showRetired ? "Hide" : "Show"} {retired.length} retired
            </button>
          </div>
        )}
        {showRetired && retired.map((r) => <RuleCard key={r.id} rule={r} slug={slug} roles={list.roles} own={own} busy={busy} run={run} />)}
      </section>

      {detail.agents_read && (
        <details className={styles.card} style={{ maxWidth: 900, marginTop: 16 }}>
          <summary className={styles.cardHead} style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>What the agents read today</h2></summary>
          <div style={{ padding: "0 16px 16px", fontSize: 13 }}><MarkdownOutput text={detail.agents_read} /></div>
        </details>
      )}

      {std && (
        <details className={styles.card} style={{ maxWidth: 900, marginTop: 16 }} open={!live.length}>
          <summary className={styles.cardHead} style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>Standard text</h2></summary>
          <div style={{ padding: "0 16px 16px", fontSize: 13 }}><MarkdownOutput text={std.body} /></div>
        </details>
      )}
    </>
  );
}

function NewOwn({ slug, roles }: { slug: string; roles: ProcedureList["roles"] }) {
  const { busy, error, run } = useRun();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div style={{ padding: "12px 16px" }}>
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          <Plus size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }} />New procedure for this client
        </button>
      </div>
    );
  }
  return (
    <>
      {error && <div className={styles.error} role="alert" style={{ margin: 16 }}>{error}</div>}
      <RuleForm rule={null} kinds={["own"]} roles={roles} own busy={busy}
        onSave={async (body) => {
          if (await run(`/api/clients/${slug}/procedure-rules`, "POST", body)) router.push(`?p=${body.procedure}`);
        }}
        onCancel={() => setOpen(false)} />
    </>
  );
}

export default function ProceduresView({ slug, list, detail, missing }: {
  slug: string; list: ProcedureList; detail: ProcedureDetail | null; missing: boolean;
}) {
  if (detail) return <Detail slug={slug} list={list} detail={detail} />;

  const roleTitle = (n: string) => list.roles.find((r) => r.name === n)?.title ?? n;
  const rulesFor = (name: string) => list.rules.filter((r) => r.procedure === name);
  const always = list.standard.filter((p) => p.always_loaded);
  const rest = list.standard.filter((p) => !p.always_loaded);
  const own = ownProcedures(list.rules);
  const drafts = liveRules(list.rules).filter((r) => r.status === "draft").length;

  return (
    <>
      {missing && <div className={styles.error} role="alert" style={{ maxWidth: 900, marginBottom: 16 }}>That procedure does not exist for this client.</div>}
      <p className={styles.intro} style={{ maxWidth: 820 }}>
        The standard procedures are how STZA&apos;s finance team works, the same for every client, and stay on
        STZA&apos;s servers. A client&apos;s rules add to one, replace one, or set out a procedure only this client
        has. A rule is a draft until someone approves it; only approved rules reach the agents.
        {drafts > 0 && <strong> {drafts} draft{drafts > 1 ? "s" : ""} waiting for approval.</strong>}
      </p>

      <section className={styles.card} style={{ maxWidth: 900 }} aria-label="Always loaded">
        <div className={styles.cardHead}><h2>Always loaded</h2><span className={styles.small}>Every agent, every run</span></div>
        {always.map((p) => (
          <Row key={p.name} href={`?p=${p.name}`} title={p.title} summary={p.summary} side={`Version ${p.version}`} pill={ruleNote(rulesFor(p.name))} />
        ))}
      </section>

      <section className={styles.card} style={{ maxWidth: 900, marginTop: 16 }} aria-label="Standard procedures">
        <div className={styles.cardHead}><h2>Standard procedures</h2><span className={styles.small}>Opened when the work needs them</span></div>
        {rest.map((p) => (
          <Row key={p.name} href={`?p=${p.name}`} title={p.title} summary={p.summary}
            side={`Version ${p.version} · ${p.roles.map(roleTitle).join(", ") || "no role yet"}`} pill={ruleNote(rulesFor(p.name))} />
        ))}
      </section>

      <section className={styles.card} style={{ maxWidth: 900, marginTop: 16 }} aria-label="This client's own procedures">
        <div className={styles.cardHead}><h2>This client&apos;s own procedures</h2></div>
        {!own.length && <div className={styles.empty}>None yet: a grant claim, a stock count, anything only this client does.</div>}
        {own.map((p) => (
          <Row key={p.name} href={`?p=${p.name}`} title={p.title} summary={p.summary}
            pill={ruleNote(p.rules) ?? { text: "Retired", pill: "s-neutral" }} />
        ))}
        <NewOwn slug={slug} roles={list.roles} />
      </section>
    </>
  );
}

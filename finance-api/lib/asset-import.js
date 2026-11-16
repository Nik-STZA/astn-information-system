// The asset register's opening import (docs/asset-register-spec.md section 8).
// Pure, so it is tested without Xero or a database: lib/asset-register-routes.js
// reads the company list, Xero's charts and trial balances and passes them in.
//
// scripts/asset-register-import.py reads a register workbook and writes the
// payload; this checks it, turns it into rows, and ties it to the ledger at the
// opening date with the engine (lib/asset-register.js). An import that does not
// tie, after its named items, is refused: a register that disagrees with the
// ledger on day one would carry the difference into every month after.

const engine = require("./asset-register");
const groupings = require("./asset-groupings");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = engine.r2;
const ROLES = ["cost", "wip", "accumulated", "charge", "impairment", "capitalisation_credit"];
const TREATMENTS = ["capitalise", "expense_research", "expense_admin", "training", "marketing", "inventory", "other_register"];
const STATUSES = ["research", "wip", "pending", "available", "registered", "impaired", "disposed", "lapsed"];

const isMonthEnd = (d) => DATE.test(String(d ?? "")) && engine.monthEnd(String(d).slice(0, 7)) === d;
const text = (v) => (v === undefined || v === null ? "" : String(v).trim());

// Everything wrong with a payload before anything is read from Xero.
// companies: the client's companies [{ id, slug, name, reporting_framework }].
function payloadIssues(body, companies) {
  const b = body || {};
  const issues = [];
  if (!groupings.isGrouping(b.grouping)) issues.push(`grouping must be one of ${Object.keys(groupings.GROUPINGS).join(", ")}`);
  if (!isMonthEnd(b.as_at)) issues.push("as_at must be a month end, YYYY-MM-DD");
  if (!Array.isArray(b.assets) || !b.assets.length) issues.push("assets is required");
  if (!Array.isArray(b.cost_lines)) issues.push("cost_lines is required");
  if (!Array.isArray(b.account_map) || !b.account_map.length) issues.push("account_map is required: which accounts the grouping uses, and who amortises each");
  if (!b.source?.original_sha256 || !b.source?.read_sha256) issues.push("source must name the file read and its fingerprints");
  if (issues.length) return issues;

  const slugs = new Set(companies.map((c) => c.slug));
  const used = new Set();
  const seen = new Set();
  for (const a of b.assets) {
    const where = `asset ${a.asset_no ?? "(no number)"}`;
    if (!text(a.asset_no) || !text(a.name)) issues.push(`${where}: needs a number and a name`);
    if (seen.has(`${a.entity}|${a.asset_no}`)) issues.push(`${where}: appears twice`);
    seen.add(`${a.entity}|${a.asset_no}`);
    if (!slugs.has(a.entity)) issues.push(`${where}: no company ${a.entity} for this client`);
    else used.add(a.entity);
    if (!STATUSES.includes(a.status)) issues.push(`${where}: status ${a.status} is not one of ${STATUSES.join(", ")}`);
    if (!a.cost_account) issues.push(`${where}: no cost account`);
  }
  const assetNos = new Set(b.assets.map((a) => `${a.entity}|${a.asset_no}`));
  b.cost_lines.forEach((l, i) => {
    const where = `cost line ${i + 1}${l.invoice_no ? ` (${l.invoice_no})` : ""}`;
    if (!DATE.test(text(l.line_date))) issues.push(`${where}: no date`);
    else if (l.line_date > b.as_at) issues.push(`${where}: dated after the opening date`);
    if (!slugs.has(l.owning_entity) || !slugs.has(l.billed_entity)) issues.push(`${where}: unknown company`);
    if (!Number.isFinite(Number(l.amount)) || !Number.isFinite(Number(l.source_net))) issues.push(`${where}: amount and source_net are required`);
    if (l.treatment && !TREATMENTS.includes(l.treatment)) issues.push(`${where}: treatment ${l.treatment} is not allowed`);
    if (l.asset_no && !assetNos.has(`${l.owning_entity}|${l.asset_no}`)) issues.push(`${where}: asset ${l.asset_no} is not in this import`);
    if (l.treatment === "capitalise" && !l.asset_no) issues.push(`${where}: capitalised with no asset`);
    if (!l.source_ref) issues.push(`${where}: no source_ref`);
  });
  for (const m of b.account_map) {
    const where = `account map ${m.entity} ${m.code} ${m.role}`;
    if (!slugs.has(m.entity)) issues.push(`${where}: unknown company`);
    if (!ROLES.includes(m.role)) issues.push(`${where}: role must be one of ${ROLES.join(", ")}`);
    if (!["register", "xero"].includes(m.amortised_by)) issues.push(`${where}: amortised_by must be register or xero`);
    if (!DATE.test(text(m.effective_from)) || (m.effective_to && !DATE.test(text(m.effective_to)))) issues.push(`${where}: dates must be YYYY-MM-DD`);
  }
  const mapped = new Set(b.account_map.map((m) => `${m.entity}|${m.code}`));
  for (const n of b.named_items || []) {
    if (!slugs.has(n.entity) || !text(n.account) || !Number.isFinite(Number(n.amount)) || text(n.label).length < 3) {
      issues.push(`named item ${n.entity} ${n.account}: needs a company, an account, an amount and a label`);
    } else if (!mapped.has(`${n.entity}|${n.account}`)) {
      issues.push(`named item ${n.entity} ${n.account}: not an account this grouping uses`);
    }
  }
  // A company whose own trial balance is out (Xero's foreign-currency
  // rounding) is acknowledged by name, amount and reason, never absorbed.
  for (const t of b.tb_acknowledgements || []) {
    if (!slugs.has(t.entity) || !Number.isFinite(Number(t.difference)) || Number(t.difference) === 0 || text(t.reason).length < 3) {
      issues.push(`trial balance acknowledgement ${t.entity}: needs a company, a difference (debits less credits) and a reason`);
    }
  }
  // The framework is the company's; a company without a template is refused.
  issues.push(...groupings.enableIssues(b.grouping, companies.filter((c) => used.has(c.slug))));
  return issues;
}

// Codes to Xero AccountIDs, per company. chart: { slug: [{ Code, AccountID, Status }] }.
function resolveAccounts(body, chart) {
  const issues = [];
  const idOf = {};
  const need = new Set();
  for (const a of body.assets) for (const c of [a.cost_account, a.accum_account]) if (c) need.add(`${a.entity}|${c}`);
  for (const m of body.account_map) need.add(`${m.entity}|${m.code}`);
  for (const l of body.cost_lines) if (l.posted_account) need.add(`${l.owning_entity}|${l.posted_account}`);
  for (const a of body.assets) if (a.opening_impairment?.credit_account) need.add(`${a.entity}|${a.opening_impairment.credit_account}`);
  for (const n of body.named_items || []) need.add(`${n.entity}|${n.account}`);
  for (const key of need) {
    const [slug, code] = key.split("|");
    const acc = (chart[slug] || []).find((x) => String(x.Code) === String(code));
    if (!acc) issues.push(`${slug}: account ${code} is not in Xero's chart of accounts`);
    else if (acc.Status && acc.Status !== "ACTIVE") issues.push(`${slug}: account ${code} is ${acc.Status} in Xero`);
    else idOf[key] = acc.AccountID;
  }
  return { issues, idOf };
}

// The rows the import writes, with keys in place of ids (the route swaps in
// ids as it inserts). ids: { slug: entity_id }.
function plan(body, { idOf, ids }) {
  const acct = (slug, code) => (code ? idOf[`${slug}|${code}`] ?? null : null);
  const period = String(body.as_at).slice(0, 7);
  const basis = "FRS 102";
  const assets = body.assets.map((a) => ({
    key: `${a.entity}|${a.asset_no}`, entity_id: ids[a.entity], grouping: body.grouping, asset_no: a.asset_no, name: a.name,
    status: a.status, cost_account_id: acct(a.entity, a.cost_account), accum_account_id: acct(a.entity, a.accum_account),
    filing_date: a.filing_date ?? null, registration_date: a.registration_date ?? null, expiry_date: a.expiry_date ?? null,
    completion_date: a.completion_date ?? null, registration_no: a.registration_no ?? null, jurisdiction: a.jurisdiction ?? null,
    ip_owner: null, ipo_url: a.ipo_url ?? null, wipo_url: a.wipo_url ?? null, ip_category: a.ip_category ?? null,
    fields: Object.fromEntries(Object.entries({
      asset_type: a.asset_type, workbook_status: a.status_raw, life_months: a.life_months, amort_start: a.amort_start,
      amort_end: a.amort_end, impairment_risk: a.impairment_risk, next_action: a.next_action,
    }).filter(([, v]) => v !== undefined && v !== null)),
    source_ref: a.source_ref,
  }));
  // Brought-forward lines first, so evidence lines can point at them.
  const lines = body.cost_lines.map((l, i) => {
    const state = l.state === "superseded" ? "superseded" : (l.treatment && (l.reason_text || "").trim().length >= 3 ? "approved" : "proposed");
    return {
      index: i, kind: l.kind ?? null, asset_key: l.asset_no ? `${l.owning_entity}|${l.asset_no}` : null,
      grouping: body.grouping, source_type: "workbook", billed_entity_id: ids[l.billed_entity], owning_entity_id: ids[l.owning_entity],
      supplier: l.supplier ?? null, invoice_no: l.invoice_no ?? null, line_date: l.line_date,
      source_net: r2(l.source_net), source_vat: l.source_vat ?? null, source_gross: l.source_gross ?? null,
      proposal_no: l.proposal_no ?? null, phase: l.phase ?? null, phase_name: l.phase_name ?? null,
      work_description: l.work_description ?? null, item: l.item ?? null, item_type: l.item_type ?? null,
      jurisdiction: l.jurisdiction ?? null, rd_milestone: l.rd_milestone ?? null, ipo_status: l.ipo_status ?? null,
      amount: r2(l.amount), percent_info: l.percent_info ?? null, treatment: l.treatment ?? null,
      reason_text: l.reason_text ?? null, posted_account_id: acct(l.owning_entity, l.posted_account),
      posted_account_code: l.posted_account ?? null, state, fields: l.fields || {}, source_ref: l.source_ref,
      superseded_by_asset_key: l.state === "superseded" && l.superseded_by_asset_no ? `${l.owning_entity}|${l.superseded_by_asset_no}` : null,
    };
  });
  const events = [];
  for (const a of body.assets) {
    if (Number(a.opening_accumulated)) {
      events.push({ asset_key: `${a.entity}|${a.asset_no}`, entity_id: ids[a.entity], kind: "opening", basis, period,
        event_date: body.as_at, amount: Math.abs(r2(a.opening_accumulated)), accounts: { accumulated: acct(a.entity, a.accum_account) },
        reason: `Accumulated amortisation brought forward at ${body.as_at} from the register workbook.`, evidence_ref: null, source_ref: a.source_ref });
    }
    const imp = a.opening_impairment;
    if (imp?.amount) {
      events.push({ asset_key: `${a.entity}|${a.asset_no}`, entity_id: ids[a.entity], kind: "impairment", basis, period: imp.date.slice(0, 7),
        event_date: imp.date, amount: Math.abs(r2(imp.amount)), accounts: { impairment: acct(a.entity, imp.credit_account) },
        reason: imp.reason || "Written off, per the register workbook's write-off log.", evidence_ref: imp.journal_ref || null, source_ref: imp.source_ref });
    }
  }
  const map = body.account_map.map((m) => ({ entity_id: ids[m.entity], grouping: body.grouping, role: m.role,
    xero_account_id: acct(m.entity, m.code), account_code: m.code, amortised_by: m.amortised_by,
    effective_from: m.effective_from, effective_to: m.effective_to ?? null, note: m.note ?? null }));
  return { period, assets, lines, events, map };
}

// The opening tie: the planned rows rolled to the opening month against each
// company's trial balance, with named items beside the difference. Every
// account in the map, and every account the register holds, is shown. Refused
// unless each trial balance foots and nothing is left unexplained.
function openingTie(p, { trialBalances, namedItems = [], idOf, ids, tolerance = 0, tbAcknowledgements = [] }) {
  const assets = p.assets.map((a) => ({ id: a.key, entity_id: a.entity_id, cost_account_id: a.cost_account_id, accum_account_id: a.accum_account_id }));
  const lines = p.lines.filter((l) => l.state === "approved").map((l) => ({
    ...l, asset_id: l.asset_key, posted_account_id: l.posted_account_id ?? p.assets.find((a) => a.key === l.asset_key)?.cost_account_id }));
  const events = p.events.map((e, i) => ({ ...e, id: `e${i}`, asset_id: e.asset_key }));
  const rolled = engine.roll({ assets, lines, events, period: p.period });
  const have = new Set(rolled.accounts.map((a) => `${a.entity_id}|${String(a.account_id).toLowerCase()}`));
  for (const m of p.map) {
    const k = `${m.entity_id}|${String(m.xero_account_id).toLowerCase()}`;
    if (m.xero_account_id && !have.has(k) && m.effective_from <= engine.monthEnd(p.period)) {
      have.add(k);
      rolled.accounts.push({ entity_id: m.entity_id, account_id: m.xero_account_id, opening: 0, additions: 0, transfers: 0, amortisation: 0, impairment: 0, other: 0, closing: 0 });
    }
  }
  const named = namedItems.map((n) => ({ entity_id: ids[n.entity], account_id: idOf[`${n.entity}|${n.account}`], label: n.label, amount: Number(n.amount) }));
  const rows = engine.tie({ rolled, trialBalances, tolerance, namedItems: named });
  const ackFor = (id) => tbAcknowledgements.find((t) => ids[t.entity] === id) || null;
  const footing = Object.fromEntries(Object.entries(trialBalances).map(([id, rep]) => [id, engine.tbFooting(rep, null, ackFor(id))]));
  const slices = engine.sliceIssues(p.lines.map((l) => ({ ...l, id: l.index })));
  const issues = [];
  for (const [id, f] of Object.entries(footing)) if (!f.foots) issues.push(...f.issues.map((x) => `${Object.keys(ids).find((s) => ids[s] === id) ?? id}: ${x}`));
  for (const r of rows) if (!r.ties) issues.push(`${Object.keys(ids).find((s) => ids[s] === r.entity_id) ?? r.entity_id} ${r.account ?? r.account_id}: register ${r.register} against ledger ${r.ledger}, ${r.unexplained} unexplained`);
  for (const s of slices) issues.push(`${s.source}: ${s.issue}`);
  return { rows, footing, slices, issues, ties: issues.length === 0 };
}

module.exports = { payloadIssues, resolveAccounts, plan, openingTie, isMonthEnd };

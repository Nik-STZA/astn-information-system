// The asset register's monthly intake (docs/asset-register-spec.md sections 4.3
// and 6): every line Xero posted to an account a grouping uses, in the month,
// becomes a proposed cost line carrying Xero's ids. The CFO decides them.
// Pure, so it is tested without Xero or a database; the route reads Xero and
// the rows and passes them in.
//
// Amounts are the base-currency net the ledger holds: a VAT-inclusive line is
// its amount less its tax (a bill entered gross showed 7,800.00 where the
// ledger took 6,500.00), and a foreign-currency line is divided by the
// document's rate.
//
// Allocation, in order: an allocation the caller supplies for that invoice
// (from the register workbook or an agent), then the one asset that holds the
// account, else unallocated with a question. A line on a shared account that
// belongs to another grouping (by its counterpart in the same document, e.g.
// staff time credited to the capitalisation account) is set aside, not taken.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lc = (s) => String(s ?? "").toLowerCase();

// Xero's /Date(1790726400000+0000)/ or an ISO string, as YYYY-MM-DD.
function xeroDay(v) {
  const m = /\/Date\((-?\d+)/.exec(String(v ?? ""));
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// The base-currency net of one line of a document.
function lineNet(doc, line) {
  const gross = Number(line.LineAmount ?? 0);
  const net = doc.LineAmountTypes === "Inclusive" ? gross - Number(line.TaxAmount ?? 0) : gross;
  const rate = Number(doc.CurrencyRate ?? 1);
  return r2(rate && rate !== 1 ? net / rate : net);
}

const inForce = (m, day) => m.effective_from <= day && (!m.effective_to || m.effective_to >= day) && !m.ended_at;

// One document's lines on the grouping's accounts, as candidate cost lines.
function docLines(doc, { kind, entityId, grouping, map, rules, day }) {
  const lines = kind === "manual_journal" ? (doc.JournalLines || []) : (doc.LineItems || []);
  const mine = map.filter((m) => m.entity_id === entityId && m.grouping === grouping && ["cost", "wip"].includes(m.role) && inForce(m, day));
  const codes = new Set(lines.map((l) => String(l.AccountCode ?? "")));
  const sign = kind === "credit_note" || (kind === "bank_transaction" && /^RECEIVE/.test(doc.Type ?? "")) ? -1 : 1;
  const out = [];
  lines.forEach((l, i) => {
    const hit = mine.find((m) => (l.AccountID && lc(l.AccountID) === lc(m.xero_account_id)) || String(l.AccountCode ?? "") === String(m.account_code));
    if (!hit) return;
    const amount = r2(sign * (kind === "manual_journal" ? Number(l.LineAmount ?? 0) : lineNet(doc, l)));
    const rule = rules.find((r) => String(r.account_code) === String(hit.account_code) && codes.has(String(r.when_counterpart_code)));
    out.push({
      kind, entity_id: entityId, day, amount, account_id: hit.xero_account_id, account_code: hit.account_code,
      source_id: doc.InvoiceID ?? doc.CreditNoteID ?? doc.BankTransactionID ?? doc.ManualJournalID,
      line_id: l.LineItemID ?? l.JournalLineID ?? `line-${i + 1}`,
      number: doc.InvoiceNumber ?? doc.CreditNoteNumber ?? doc.Reference ?? null,
      supplier: doc.Contact?.Name ?? null, description: l.Description ?? doc.Narration ?? null,
      currency: doc.CurrencyCode ?? null, foreign: doc.CurrencyRate && Number(doc.CurrencyRate) !== 1,
      inclusive: doc.LineAmountTypes === "Inclusive", gross: r2(l.LineAmount), vat: r2(l.TaxAmount ?? 0),
      set_aside: rule ? { belongs_to: rule.belongs_to, why: `its document also posts to ${rule.when_counterpart_code}` } : null,
    });
  });
  return out;
}

const STATUS_OK = { bill: ["AUTHORISED", "PAID"], credit_note: ["AUTHORISED", "PAID"], bank_transaction: ["AUTHORISED"], manual_journal: ["POSTED"] };
const SOURCE_TYPE = { bill: "invoice", credit_note: "invoice", bank_transaction: "bank_transaction", manual_journal: "manual_journal" };

// period YYYY-MM. docs: [{ entity_id, bills, credit_notes, bank_transactions, manual_journals }].
// assets: the grouping's assets. existing: Set of "type|source|line" already held.
// hints: [{ invoice_no, entity_id?, slices: [{ asset_no, amount, treatment, reason }] }].
function intake({ period, grouping, map, assets, docs, existing = new Set(), rules = [], hints = [] }) {
  const lines = [];
  const setAside = [];
  const findings = [];
  const seen = new Set();
  for (const d of docs) {
    for (const [kind, list] of [["bill", d.bills], ["credit_note", d.credit_notes], ["bank_transaction", d.bank_transactions], ["manual_journal", d.manual_journals]]) {
      for (const doc of list || []) {
        const day = xeroDay(doc.DateString ?? doc.Date);
        if (!day || day.slice(0, 7) !== period) continue;
        const cands = docLines(doc, { kind, entityId: d.entity_id, grouping, map, rules, day });
        if (!cands.length) continue;
        if (!STATUS_OK[kind].includes(doc.Status)) {
          if (!["VOIDED", "DELETED"].includes(doc.Status)) {
            findings.push({ kind: "waiting_in_xero", number: cands[0].number, status: doc.Status, amount: r2(cands.reduce((s, c) => s + c.amount, 0)),
              note: "On an account this register uses, but not yet approved in Xero; taken in when it is." });
          }
          continue;
        }
        for (const c of cands) {
          const key = `${SOURCE_TYPE[kind]}|${c.source_id}|${c.line_id}`;
          if (existing.has(key) || seen.has(key)) continue;
          seen.add(key);
          if (c.set_aside) { setAside.push({ ...c, key }); continue; }
          if (c.foreign) findings.push({ kind: "foreign_currency", number: c.number, currency: c.currency, amount: c.amount, note: "Converted at the document's rate." });
          lines.push(...allocate(c, { kind, assets, hints, findings }));
        }
      }
    }
  }
  const byAccount = {};
  for (const s of setAside) {
    const k = `${s.entity_id}|${s.account_code}|${s.set_aside.belongs_to}`;
    byAccount[k] = r2((byAccount[k] ?? 0) + s.amount);
  }
  return {
    lines, findings,
    set_aside: Object.entries(byAccount).map(([k, amount]) => {
      const [entity_id, account_code, belongs_to] = k.split("|");
      return { entity_id, account_code, belongs_to, amount };
    }),
    set_aside_lines: setAside,
  };
}

// A candidate line as one or more proposed cost lines.
function allocate(c, { kind, assets, hints, findings }) {
  const base = {
    source_type: SOURCE_TYPE[kind], xero_source_id: c.source_id, xero_line_id: c.line_id, billed_entity_id: c.entity_id,
    owning_entity_id: c.entity_id, supplier: c.supplier, invoice_no: c.number, line_date: c.day, source_net: c.amount,
    source_vat: c.vat, source_gross: c.gross, currency: c.currency ?? "GBP", work_description: c.description,
    posted_account_id: c.account_id, posted_account_code: c.account_code, state: "proposed",
  };
  const fields = { intake: true, ...(c.inclusive ? { entered_vat_inclusive: true } : {}) };
  const hint = c.number && hints.find((h) => lc(h.invoice_no) === lc(c.number) && (!h.entity_id || h.entity_id === c.entity_id));
  if (hint) {
    // Only the slices for assets on this line's account; amounts as given.
    const mineSlices = hint.slices.filter((s) => {
      const a = assets.find((x) => x.asset_no === s.asset_no);
      return !s.asset_no || (a && lc(a.cost_account_id) === lc(c.account_id));
    });
    const total = r2(mineSlices.reduce((s, x) => s + Number(x.amount), 0));
    if (mineSlices.length && total === c.amount) {
      return mineSlices.map((s) => {
        const a = assets.find((x) => x.asset_no === s.asset_no);
        return { ...base, asset_id: a?.id ?? null, amount: r2(s.amount), treatment: s.treatment ?? null,
          reason_text: s.reason ?? null, fields: { ...fields, allocation: "hint", source_key: `${c.source_id}|${c.line_id}` } };
      });
    }
    findings.push({ kind: "allocation_does_not_match", number: c.number, account: c.account_code, line: c.amount, allocation: total });
  }
  const holders = assets.filter((a) => lc(a.cost_account_id) === lc(c.account_id) && !["disposed", "lapsed", "impaired"].includes(a.status));
  if (holders.length === 1) {
    return [{ ...base, asset_id: holders[0].id, amount: c.amount, treatment: "capitalise",
      reason_text: `Posted to ${c.account_code}; ${holders[0].asset_no} ${holders[0].name} is the only asset on it.`,
      fields: { ...fields, allocation: "only_asset_on_account" } }];
  }
  const question = holders.length
    ? `Which of ${holders.map((h) => h.asset_no).join(", ")} is this for?`
    : `Posted to ${c.account_code}, which no asset holds. Which asset is it for, or should the bill be recoded in Xero?`;
  if (!holders.length) findings.push({ kind: "posted_where_no_asset", number: c.number, account: c.account_code, amount: c.amount });
  return [{ ...base, asset_id: null, amount: c.amount, treatment: null, reason_text: null, fields: { ...fields, question } }];
}

module.exports = { intake, lineNet, xeroDay };

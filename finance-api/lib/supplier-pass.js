// The mechanical pass of the supplier master cleanup (docs/ap-lane/ap-lane-spec.md
// section 2.4, step 2): for each live supplier, what the ledger has actually done
// with it, beside what its Xero contact says it should do.
//
// "Live" means a bill or supplier credit note in the window (12 months by
// default), as the spec defines it. A payee met only through spend money (card
// spend: restaurants, taxis, trains) is counted, not listed: the first live run
// on 20 Oct put 168 UDL "suppliers" on the list, most of them lunches.
// Everything else on the supplier list is dormant and is only counted (spec Q3).
//
// Lines coded to a balance-sheet account (an accrual or director's loan being
// paid, PAYE, pensions) are counted per supplier but kept out of the account and
// VAT analysis: they are payments of something already recognised, not a
// purchase, and on 20 Oct they made HMRC look like a supplier.
//
// What it reads, per entity: approved purchase documents (drafts are counted but
// not used: on 12 Oct the drafts were Xero's own mis-coded OCR, the thing this
// lane exists to stop trusting), the supplier contacts, and the organisation
// (base currency, and PaysTax: STZA is not VAT registered, so VAT flags would
// be noise there).
//
// Amounts are net, in the entity's base currency, in pence. A line entered tax
// inclusive has its tax taken off first; a foreign document is converted at the
// rate Xero stored on it.
//
// This computes and flags. It does not decide a VAT treatment, and it never
// writes. The flags are prompts for the proposal pass and for Nik.

const pence = (v) => Math.round(Number(v || 0) * 100);
const money = (p) => (p / 100).toFixed(2);

// Xero's JSON dates come as "/Date(1727654400000+0000)/", with DateString beside
// them on most resources.
function docDate(d) {
  if (d.DateString) return String(d.DateString).slice(0, 10);
  const ms = /\/Date\((-?\d+)/.exec(String(d.Date || ""));
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : String(d.Date || "").slice(0, 10);
}

// Group-level identity is by name until the master holds VAT and company
// numbers: "Dragon Argent Ltd" and "Dragon Argent Limited" are one supplier.
const SUFFIX = /\b(ltd|limited|plc|llp|llc|inc|incorporated|gmbh|bv|sa|sarl|pty|pte|co|company|corp|corporation|uk|t\/a.*)\b/g;
function normaliseName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const UK = new Set(["GB", "UK", "UNITED KINGDOM", "GREAT BRITAIN", "ENGLAND", "SCOTLAND", "WALES", "NORTHERN IRELAND"]);
function contactCountry(contact) {
  const addrs = contact?.Addresses || [];
  const pick = addrs.find((a) => a.AddressType === "STREET" && a.Country) || addrs.find((a) => a.Country);
  return pick ? String(pick.Country).trim() : null;
}

// The purchase documents of one entity, flattened to lines with a sign and a
// base-currency net. Credit notes count negative.
function purchaseLines({ bills = [], credits = [], spends = [] }) {
  const out = [];
  const add = (doc, source, sign) => {
    const rate = Number(doc.CurrencyRate) || 1;
    const inclusive = doc.LineAmountTypes === "Inclusive";
    for (const li of doc.LineItems || []) {
      const gross = pence(li.LineAmount);
      const tax = pence(li.TaxAmount);
      const net = inclusive ? gross - tax : gross;
      out.push({
        contact_id: doc.Contact?.ContactID || null,
        contact_name: doc.Contact?.Name || null,
        doc_id: doc.InvoiceID || doc.CreditNoteID || doc.BankTransactionID,
        source,
        date: docDate(doc),
        currency: doc.CurrencyCode || null,
        account: li.AccountCode || null,
        tax_type: li.TaxType || null,
        net_base: Math.round((sign * net) / rate),
        tax_doc: sign * tax,
      });
    }
  };
  for (const b of bills) add(b, "bill", 1);
  for (const c of credits) add(c, "credit", -1);
  for (const s of spends) add(s, "spend", 1);
  return out.filter((l) => l.contact_id);
}

const USED = new Set(["AUTHORISED", "PAID", "SUBMITTED"]);

function tally(map, key, net) {
  const k = key || "(none)";
  map[k] = map[k] || { n: 0, net: 0 };
  map[k].n += 1;
  map[k].net += net;
}

const toMoney = (m) => Object.fromEntries(
  Object.entries(m).sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net)).map(([k, v]) => [k, { n: v.n, net: money(v.net) }])
);

/**
 * One entity's pass.
 *
 * input: { entity, organisation, contacts, bills, credits, spends, from }
 *   bills / credits / spends are Xero list results (ACCPAY invoices, ACCPAYCREDIT
 *   credit notes, SPEND bank transactions) already limited to the window.
 * returns { entity, base_currency, pays_tax, live: [...], dormant: {...}, drafts }
 */
const BALANCE_SHEET = new Set(["ASSET", "LIABILITY", "EQUITY"]);

function entityPass({ entity, organisation = {}, contacts = [], accounts = [], bills = [], credits = [], spends = [], from }) {
  const base = organisation.BaseCurrency || "GBP";
  const paysTax = organisation.PaysTax !== false;
  const inWindow = (d) => !from || docDate(d) >= from;
  const used = (docs) => docs.filter((d) => USED.has(d.Status) && inWindow(d));
  const drafts = [...bills, ...credits].filter((d) => d.Status === "DRAFT" && inWindow(d)).length;
  // Spend money has no approval status; a deleted one is the only one to drop.
  const liveSpends = spends.filter((s) => s.Status !== "DELETED" && inWindow(s));

  const bsCodes = new Set(accounts.filter((a) => BALANCE_SHEET.has(a.Class)).map((a) => a.Code));
  const all = purchaseLines({ bills: used(bills), credits: used(credits), spends: liveSpends });
  const billed = new Set(all.filter((l) => l.source !== "spend").map((l) => l.contact_id));
  const bsLines = new Map();
  const lines = all.filter((l) => {
    if (!bsCodes.has(l.account)) return true;
    bsLines.set(l.contact_id, (bsLines.get(l.contact_id) || 0) + 1);
    return false;
  });
  const spendOnly = new Map();
  for (const l of all) {
    if (billed.has(l.contact_id)) continue;
    const s = spendOnly.get(l.contact_id) || { name: l.contact_name, lines: 0, net: 0, balanceSheet: 0 };
    s.lines += 1;
    s.net += l.net_base;
    // Paid on another entity's behalf (Feldspar intercompany), payroll, the
    // director's loan: kept apart so the purchase figure is not overstated.
    if (bsCodes.has(l.account)) s.balanceSheet += l.net_base;
    spendOnly.set(l.contact_id, s);
  }
  const byContact = new Map(contacts.map((c) => [c.ContactID, c]));
  const groups = new Map();
  for (const l of lines) {
    if (!billed.has(l.contact_id)) continue;
    if (!groups.has(l.contact_id)) groups.set(l.contact_id, []);
    groups.get(l.contact_id).push(l);
  }

  const live = [];
  for (const [id, ls] of groups) {
    const c = byContact.get(id) || {};
    const accounts = {}, taxTypes = {}, currencies = {}, sources = {};
    const docs = new Set();
    let net = 0, taxCharged = 0;
    for (const l of ls) {
      tally(accounts, l.account, l.net_base);
      tally(taxTypes, l.tax_type, l.net_base);
      tally(currencies, l.currency, l.net_base);
      tally(sources, l.source, l.net_base);
      docs.add(l.doc_id);
      net += l.net_base;
      if (l.currency && l.currency !== base) taxCharged += Math.abs(l.tax_doc);
    }
    const dates = ls.map((l) => l.date).sort();
    const country = contactCountry(c);
    const nonUk = country && !UK.has(country.toUpperCase());
    const foreignCcy = Object.keys(currencies).some((k) => k !== "(none)" && k !== base);
    const defaultTax = c.AccountsPayableTaxType || null;
    const defaultAccount = c.PurchasesDefaultAccountCode || null;
    const topTax = Object.keys(toMoney(taxTypes))[0];
    const topAccount = Object.keys(toMoney(accounts))[0];

    const flags = [];
    if (Object.keys(accounts).length > 1) flags.push("mixed_account");
    if (!defaultAccount) flags.push("no_default_account");
    else if (defaultAccount !== topAccount) flags.push("default_account_not_main");
    if (!country) flags.push("no_country");
    if (paysTax) {
      if (Object.keys(taxTypes).length > 1) flags.push("mixed_tax");
      if (!defaultTax) flags.push("no_default_tax");
      else if (defaultTax !== topTax) flags.push("default_tax_not_main");
      if (foreignCcy && taxCharged > 0) flags.push("foreign_currency_vat_charged");
      if ((nonUk || foreignCcy) && !taxTypes.REVERSECHARGES) flags.push("possible_reverse_charge");
      if (!nonUk && !foreignCcy && !c.TaxNumber && taxTypes.INPUT2) flags.push("vat_claimed_no_vat_number");
    }

    live.push({
      entity,
      contact_id: id,
      name: c.Name || ls[0].contact_name,
      group_key: normaliseName(c.Name || ls[0].contact_name),
      contact_status: c.ContactStatus || null,
      country,
      tax_number: c.TaxNumber || null,
      company_number: c.CompanyNumber || null,
      default_account: defaultAccount,
      default_tax: defaultTax,
      default_currency: c.DefaultCurrency || null,
      documents: docs.size,
      balance_sheet_lines: bsLines.get(id) || 0,
      net: money(net),
      net_pence: net,
      first: dates[0],
      last: dates[dates.length - 1],
      accounts: toMoney(accounts),
      tax_types: toMoney(taxTypes),
      currencies: toMoney(currencies),
      sources: toMoney(sources),
      flags,
    });
  }

  // A billed supplier whose every line went to the balance sheet still counts
  // as live; it just has nothing to analyse.
  for (const id of billed) {
    if (live.some((s) => s.contact_id === id)) continue;
    const c = byContact.get(id) || {};
    live.push({ entity, contact_id: id, name: c.Name, group_key: normaliseName(c.Name), documents: 0, balance_sheet_lines: bsLines.get(id) || 0, net: money(0), net_pence: 0, accounts: {}, tax_types: {}, currencies: {}, sources: {}, flags: ["balance_sheet_only"] });
  }
  const liveIds = new Set(live.map((s) => s.contact_id));
  const dormant = contacts.filter((c) => c.IsSupplier && !liveIds.has(c.ContactID) && !spendOnly.has(c.ContactID) && c.ContactStatus !== "ARCHIVED");

  // Two live contacts in one entity that normalise to one name are probably one
  // supplier keyed twice.
  const byKey = new Map();
  for (const s of live) byKey.set(s.group_key, [...(byKey.get(s.group_key) || []), s]);
  for (const same of byKey.values()) {
    if (same.length > 1) for (const s of same) s.flags.push("possible_duplicate_contact");
  }

  return {
    entity,
    base_currency: base,
    pays_tax: paysTax,
    drafts_ignored: drafts,
    live: live.sort(rank),
    spend_only: (() => {
      const v = [...spendOnly.values()];
      const bs = v.reduce((t, s) => t + s.balanceSheet, 0);
      return { count: v.length, net: money(v.reduce((t, s) => t + s.net, 0) - bs), balance_sheet: money(bs) };
    })(),
    dormant: { count: dormant.length, names: dormant.map((c) => c.Name).sort() },
  };
}

// The spec lists mixed-treatment suppliers first, then by size.
function rank(a, b) {
  const m = (s) => (s.flags.includes("mixed_tax") ? 0 : 1);
  return m(a) - m(b) || Math.abs(b.net_pence) - Math.abs(a.net_pence);
}

// Group-level view: one row per supplier identity across the client's entities.
function groupPass(entityResults) {
  const groups = new Map();
  for (const r of entityResults) {
    for (const s of r.live) {
      if (!groups.has(s.group_key)) groups.set(s.group_key, { group_key: s.group_key, names: new Set(), entities: [] });
      const g = groups.get(s.group_key);
      g.names.add(s.name);
      g.entities.push({ entity: s.entity, contact_id: s.contact_id, net: s.net, flags: s.flags });
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, names: [...g.names], flagged: g.entities.some((e) => e.flags.length) }))
    .sort((a, b) => b.entities.length - a.entities.length || a.group_key.localeCompare(b.group_key));
}

module.exports = { entityPass, groupPass, normaliseName, purchaseLines, contactCountry, docDate };

// The CFO's decision on a supplier (docs/ap-lane/ap-lane-spec.md 2.4 step 4):
// from a pending proposal, or with no proposal at all, to the supplier master
// rows finance-api writes. Pure: the route reads the rows, this plans the
// writes, the route applies them in one transaction.
//
// The decisions (finance.supplier_proposals.decision):
//
//   approved        the proposal as it stands becomes the determination
//   edited          the proposal with the CFO's edits; or, with no proposal, a
//                   record made from the edits and the Xero contact name
//   always_discuss  bills always go to the CFO as a question; no default
//   excluded        not a supplier for the master (an expense-claim payee)
//   question        stays open with the CFO's question; the master is untouched
//   rejected        the proposal is wrong and is not used; the master is untouched
//
// The flags that govern review (related party, always discuss, mixed
// treatment) and a supplier's status are set only by the CFO, here. The model's
// own always_discuss is advice shown in the queue, never copied to the master.
//
// Nothing here touches Xero. Writing an approved determination to the contact
// is step 5, with its own dry run.

const DECISIONS = ["approved", "edited", "always_discuss", "excluded", "question", "rejected"];
const WITHOUT_PROPOSAL = ["edited", "always_discuss", "excluded"];
const TAX_TYPES = ["INPUT2", "EXEMPTINPUT", "ZERORATEDINPUT", "NONE", "REVERSECHARGES"];
const VAT_BASES = [
  "uk_charges_vat", "uk_exempt", "uk_zero_rated", "uk_not_registered",
  "non_uk_services_reverse_charge", "non_uk_services_where_performed", "non_uk_goods",
  "intra_vat_group",
  // Set by the CFO on facts the tree does not ask about, never by the model; the
  // reasoning is the vat_basis_note (migration 020, 22 Oct 2026).
  "cfo_decision",
];
const SUPPLIER_TYPES = ["company", "sole_trader", "individual", "public_body", "expense_payee"];

// What an edit may set, and how each value is checked. null clears a field.
const text = (max) => (v) => (typeof v === "string" && v.trim() && v.length <= max ? null : `must be text of at most ${max} characters`);
const oneOf = (list) => (v) => (list.includes(v) ? null : `must be one of ${list.join(", ")}`);
const bool = (v) => (typeof v === "boolean" ? null : "must be true or false");
const SUPPLIER_FIELDS = {
  legal_name: text(200),
  trading_name: text(200),
  country_of_establishment: (v) => (/^[A-Z]{2}$/.test(v) ? null : "must be an ISO 3166 alpha-2 code, e.g. GB"),
  vat_number: text(30),
  company_number: text(30),
  supplier_type: oneOf(SUPPLIER_TYPES),
  related_party: bool,
  always_discuss: bool,
  mixed_treatment: bool,
  // excluded is a decision of its own, not an edit.
  status: oneOf(["active", "dormant"]),
  status_reason: text(500),
};
const LINK_FIELDS = {
  default_account_code: (v) => (/^[A-Za-z0-9.-]{1,10}$/.test(v) ? null : "must be a Xero account code"),
  default_tax_type: oneOf(TAX_TYPES),
  vat_basis: oneOf(VAT_BASES),
  vat_basis_note: text(500),
  default_currency: (v) => (/^[A-Z]{3}$/.test(v) ? null : "must be an ISO 4217 code, e.g. GBP"),
  payment_terms_days: (v) => (Number.isInteger(v) && v >= 0 && v <= 365 ? null : "must be whole days, 0 to 365"),
};
// Never settable, whatever is sent: bank details stay out of the master (2.3).
const NOT_STORED = /bank|iban|sort_?code|swift|account_number/i;

const value = (cited) => {
  const v = cited && typeof cited === "object" ? cited.value : cited;
  return typeof v === "string" && v.trim() && !/^not shown$/i.test(v.trim()) ? v.trim() : null;
};

// The master fields a proposal supports, before any edit.
function fromProposal(p) {
  if (!p) return { supplier: {}, link: {} };
  // An expense payee's "invoice" is someone else's receipt, so nothing read from
  // it describes the contact: not the name, the VAT number nor the defaults.
  // 21 Oct 2026: deciding Tim Godfrey's proposals renamed his record after the
  // receipt issuers and gave it Soho Works' VAT number.
  if (p.expense_payee_suspected) return { supplier: { supplier_type: "expense_payee" }, link: {} };
  const country = value(p.country_of_establishment)?.toUpperCase();
  const currency = value(p.default_currency)?.toUpperCase();
  return {
    supplier: {
      legal_name: value(p.legal_name),
      trading_name: value(p.trading_name),
      country_of_establishment: /^[A-Z]{2}$/.test(country || "") ? country : null,
      vat_number: value(p.vat_number),
      company_number: value(p.company_number),
    },
    link: {
      default_account_code: value(p.proposed_account),
      default_tax_type: TAX_TYPES.includes(p.proposed_tax_type) ? p.proposed_tax_type : null,
      vat_basis: VAT_BASES.includes(p.vat_branch) && p.vat_branch !== "cfo_decision" ? p.vat_branch : null,
      vat_basis_note: typeof p.reasoning === "string" ? p.reasoning.slice(0, 500) : null,
      default_currency: /^[A-Z]{3}$/.test(currency || "") ? currency : null,
    },
  };
}

function checkEdits(edits, errors) {
  const out = { supplier: {}, link: {} };
  if (edits == null) return out;
  if (typeof edits !== "object" || Array.isArray(edits)) {
    errors.push("edits must be an object of field: value");
    return out;
  }
  for (const [field, v] of Object.entries(edits)) {
    if (NOT_STORED.test(field)) { errors.push(`${field}: bank details are never stored in the supplier master`); continue; }
    const check = SUPPLIER_FIELDS[field] || LINK_FIELDS[field];
    if (!check) { errors.push(`${field}: not a field a decision can set`); continue; }
    if (v !== null) {
      const problem = check(v);
      if (problem) { errors.push(`${field}: ${problem}`); continue; }
    }
    if (field === "legal_name" && v === null) { errors.push("legal_name: cannot be cleared"); continue; }
    (SUPPLIER_FIELDS[field] ? out.supplier : out.link)[field] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/**
 * Plans the writes for one decision.
 *
 *   decision      one of DECISIONS
 *   note          the CFO's words; required where the decision is a judgement
 *                 with no fields to show for it
 *   edits         { field: value } over SUPPLIER_FIELDS and LINK_FIELDS
 *   proposal      the stored proposal JSON, or null for a decision made
 *                 without one
 *   supplier      the finance.suppliers row this contact resolves to, or null
 *   link          the finance.supplier_entities row for (entity, contact), or null
 *   contactName   the Xero contact name now
 *
 * Returns { errors, supplier, link }. supplier and link are the full rows to
 * upsert (null = leave the master alone); link.status 'approved' means the
 * route stamps the approver.
 */
function planDecision({ decision, note, edits, proposal = null, supplier = null, link = null, contactName }) {
  const errors = [];
  if (!DECISIONS.includes(decision)) {
    return { errors: [`decision must be one of ${DECISIONS.join(", ")}`], supplier: null, link: null };
  }
  if (!proposal && !WITHOUT_PROPOSAL.includes(decision)) {
    errors.push(`${decision} needs a proposal; without one, use ${WITHOUT_PROPOSAL.join(", ")}`);
  }
  const noteText = typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null;
  if (["excluded", "question", "rejected", "always_discuss"].includes(decision) && !noteText) {
    errors.push(`${decision} needs a note saying why`);
  }
  const edit = checkEdits(edits, errors);
  // Fields sent, valid or not: a refused edit is reported once, as itself.
  const edited = edits != null && typeof edits === "object" && Object.keys(edits).length > 0;
  if (decision === "approved" && edited) errors.push("approved takes the proposal as it stands; send edits with decision edited");
  if (decision === "edited" && !edited) errors.push("edited needs at least one edit");
  if (["question", "rejected"].includes(decision) && edited) errors.push(`${decision} leaves the master alone; edits are not applied`);
  if (errors.length) return { errors, supplier: null, link: null };

  if (decision === "question" || decision === "rejected") return { errors, supplier: null, link: null };

  // The model proposes; the stored master and the CFO's edits outrank it. On
  // approve or edit, the proposal's identity replaces the stored one (that is
  // what is being approved); flags never come from the proposal.
  const base = fromProposal(proposal);
  const keepIdentity = decision === "always_discuss" || decision === "excluded";
  const pick = (k) => (keepIdentity ? (supplier?.[k] ?? base.supplier[k]) : (base.supplier[k] ?? supplier?.[k])) ?? null;
  const s = {
    legal_name: pick("legal_name") || supplier?.legal_name || contactName || null,
    trading_name: pick("trading_name"),
    country_of_establishment: pick("country_of_establishment"),
    vat_number: pick("vat_number"),
    company_number: pick("company_number"),
    supplier_type: supplier?.supplier_type || base.supplier.supplier_type || "company",
    related_party: supplier?.related_party ?? false,
    always_discuss: supplier?.always_discuss ?? false,
    mixed_treatment: supplier?.mixed_treatment ?? false,
    status: supplier?.status || "active",
    status_reason: supplier?.status_reason ?? null,
    ...edit.supplier,
  };
  if (!s.legal_name) errors.push("legal_name: not on the proposal; send it as an edit");

  const linkBase = keepIdentity ? {} : base.link;
  const l = {
    default_account_code: link?.default_account_code ?? null,
    default_tax_type: link?.default_tax_type ?? null,
    vat_basis: link?.vat_basis ?? null,
    vat_basis_note: link?.vat_basis_note ?? null,
    default_currency: link?.default_currency ?? null,
    payment_terms_days: link?.payment_terms_days ?? null,
    ...Object.fromEntries(Object.entries(linkBase).filter(([, v]) => v != null)),
    ...edit.link,
    status: link?.status || "proposed",
  };

  if (decision === "always_discuss") {
    s.always_discuss = true;
  } else if (decision === "excluded") {
    s.status = "excluded";
    s.status_reason = noteText;
    l.default_tax_type = null;
    l.default_account_code = null;
    l.status = "proposed";
  } else {
    // approved / edited: the determination itself.
    if (decision === "approved" && proposal?.vat_branch === "question") {
      errors.push("the proposal asked a question instead of choosing a treatment: answer it with edits (default_tax_type, vat_basis), or decide always_discuss or question");
    }
    if (decision === "approved" && proposal?.contradiction) {
      errors.push("the proposal contradicted itself (its VAT type did not follow from its branch): set default_tax_type and vat_basis as edits");
    }
    if (s.mixed_treatment && l.default_tax_type) {
      errors.push("mixed treatment: no default VAT type, every bill is reviewed (clear default_tax_type or mixed_treatment)");
    }
    if (l.default_tax_type && !l.vat_basis) {
      errors.push("default_tax_type needs its vat_basis: a VAT type alone is not evidence");
    } else if (edit.link.default_tax_type && edit.link.default_tax_type !== base.link.default_tax_type && !("vat_basis" in edit.link)) {
      // A changed treatment must not inherit the basis of the one it replaced.
      errors.push("a changed default_tax_type needs its own vat_basis in the edits");
    }
    if (l.vat_basis === "cfo_decision") {
      // The CFO's reasoning is the evidence: an explicit note, else the decision note.
      if (!("vat_basis_note" in edit.link)) l.vat_basis_note = noteText;
      if (!l.vat_basis_note) errors.push("vat_basis cfo_decision needs the reasoning, as vat_basis_note or the note");
    }
    // No default means no basis either: a basis on its own reads as a treatment.
    if (s.mixed_treatment && !l.default_tax_type) l.vat_basis = null;
    l.status = "approved";
  }

  if (errors.length) return { errors, supplier: null, link: null };
  return { errors, supplier: s, link: l };
}

// The audit record of a decision: what changed, field by field.
function changes(before, after) {
  if (!after) return {};
  const out = {};
  for (const [k, v] of Object.entries(after)) {
    const was = before?.[k] ?? null;
    if (was !== v) out[k] = { from: was, to: v };
  }
  return out;
}

module.exports = { DECISIONS, SUPPLIER_FIELDS, LINK_FIELDS, fromProposal, planDecision, changes };

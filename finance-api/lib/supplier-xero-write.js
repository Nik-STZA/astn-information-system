// Writing an approved supplier determination to its Xero contact
// (docs/ap-lane/ap-lane-spec.md 2.4 step 5). Pure: the route reads the master
// rows, the Xero contact and the proposal the decision came from; this plans
// what is sent. The route applies it through the write gate (dry run first).
//
// What is written, per entity:
//   - the coding defaults: AccountsPayableTaxType, PurchasesDefaultAccountCode;
//   - the VAT number and company number, only where the contact has none;
//   - one history note carrying the determination (spec 2.3), append-only, so
//     a later change adds a note and the old one stays;
//   - the invoice the determination was based on, attached to the contact.
//
// Never written (spec 2.6): name, address, email, phone, bank details, status.
// A VAT or company number that differs from the contact's is reported, not
// overwritten: which one is right is the CFO's call, made in Xero.

const BASIS_LABELS = {
  uk_charges_vat: "UK supplier, charges UK VAT",
  uk_exempt: "UK supplier, exempt supply",
  uk_zero_rated: "UK supplier, zero-rated supply",
  uk_not_registered: "UK supplier, not VAT registered",
  non_uk_services_reverse_charge: "non-UK supplier, B2B services, general rule: reverse charge",
  non_uk_services_where_performed: "non-UK supplier, services taxed where performed: no UK VAT",
  non_uk_goods: "non-UK supplier, goods",
  intra_vat_group: "same VAT group",
  cfo_decision: "CFO decision",
};

const norm = (v) => String(v ?? "").replace(/[\s.-]/g, "").toUpperCase();
const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

// Whether this link is one to write at all, and why not.
function skipReason({ supplier, link }) {
  if (!supplier || !link) return "not in the supplier master";
  if (supplier.status === "excluded") return "excluded from the master: nothing is written";
  if (supplier.status === "dormant") return "dormant: nothing is written (archiving is the CFO's, in Xero)";
  if (link.status !== "approved") return "not approved";
  if (link.written_to_xero_at) return `already written to Xero ${day(link.written_to_xero_at)}`;
  return null;
}

// The one-line determination note (spec 2.3). Example:
//   VAT: REVERSECHARGES - non-UK supplier (IE), B2B services, general rule:
//   reverse charge. Default 453. Source: invoice 5713451497 (20 Oct 2026).
//   Approved nik@stza.io, 21 Oct 2026.
function determinationNote({ supplier, link, source }) {
  let vat;
  if (supplier.mixed_treatment) vat = "VAT: no default, mixed treatment: every bill is reviewed";
  else if (link.default_tax_type) {
    const label = BASIS_LABELS[link.vat_basis] || link.vat_basis || "basis not recorded";
    const country = supplier.country_of_establishment && /^non_uk/.test(link.vat_basis || "") ? ` (${supplier.country_of_establishment})` : "";
    vat = `VAT: ${link.default_tax_type} - ${label.replace(/^non-UK supplier/, `non-UK supplier${country}`)}`;
    // The stored reasoning may repeat the label and carry its own full stop.
    const why = String(link.vat_basis_note || "").trim().replace(/^CFO decision:\s*/i, "").replace(/\.+$/, "");
    if (link.vat_basis === "cfo_decision" && why) vat += `: ${why}`;
  } else vat = "VAT: no default";
  const parts = [vat];
  if (supplier.always_discuss) parts.push("Always discuss: every bill goes to the CFO");
  if (supplier.related_party) parts.push("Related party");
  parts.push(link.default_account_code ? `Default ${link.default_account_code}` : "No default account");
  if (source?.number || source?.file) {
    parts.push(`Source: invoice ${source.number || source.file}${source.date ? ` (${day(source.date)})` : ""}`);
  }
  parts.push(`Approved ${link.approved_by_email}, ${day(link.approved_at)}`);
  return parts.join(". ") + ".";
}

/**
 * Plans the write for one supplier in one entity.
 *
 *   supplier     finance.suppliers row
 *   link         finance.supplier_entities row (this entity, this contact)
 *   contact      the Xero contact as it is now
 *   source       { id, number, date, file } - the invoice the decision was
 *                based on (proposal.invoice_used), or null
 *   attachments  the contact's current attachments (to avoid a second copy)
 *
 * Returns { skip } or { issues, fields, warnings, note, attach }:
 *   fields    Xero contact fields to send (only what changes; may be empty)
 *   changes   field: { from, to } for the dry run
 *   warnings  what the CFO should see but nothing here changes
 *   attach    { invoice_id, file_name } or null
 */
function planContactWrite({ supplier, link, contact, source = null, attachments = [] }) {
  const skip = skipReason({ supplier, link });
  if (skip) return { skip };
  const issues = [];
  const warnings = [];
  const fields = {};
  const changes = {};
  if (!contact) return { skip: null, issues: ["Xero contact not found in this entity"], fields, changes, warnings, note: null, attach: null };
  if (contact.ContactStatus && contact.ContactStatus !== "ACTIVE") issues.push(`Xero contact is ${contact.ContactStatus}`);

  const set = (field, to) => {
    const from = contact[field] ?? null;
    if ((from || null) !== to) { fields[field] = to; changes[field] = { from: from || null, to }; }
  };

  // Coding defaults. With none in the master (mixed treatment, always discuss)
  // a default already on the contact would pre-fill every bill, so it is shown;
  // clearing it is done by hand in Xero.
  if (link.default_tax_type) set("AccountsPayableTaxType", link.default_tax_type);
  else if (contact.AccountsPayableTaxType) {
    warnings.push(`The contact still defaults bills to ${contact.AccountsPayableTaxType}; the master has no default VAT type. Clear it in Xero so bills do not pre-fill it`);
  }
  if (link.default_account_code) set("PurchasesDefaultAccountCode", link.default_account_code);
  else if (contact.PurchasesDefaultAccountCode) {
    warnings.push(`The contact still defaults bills to account ${contact.PurchasesDefaultAccountCode}; the master has no default account`);
  }

  // Identity: fill a blank, report a difference, never overwrite.
  for (const [field, value, label] of [
    ["TaxNumber", supplier.vat_number, "VAT number"],
    ["CompanyNumber", supplier.company_number, "company number"],
  ]) {
    if (!value) continue;
    const now = contact[field];
    if (!now) { fields[field] = value; changes[field] = { from: null, to: value }; }
    else if (norm(now) !== norm(value)) warnings.push(`The contact's ${label} is ${now}; the master holds ${value}. Not changed: confirm which is right`);
  }

  const note = determinationNote({ supplier, link, source });

  let attach = null;
  if (source?.id && source?.file) {
    if (attachments.some((a) => a.FileName === source.file)) warnings.push(`${source.file} is already attached to the contact`);
    else attach = { invoice_id: source.id, file_name: source.file };
  } else warnings.push("No source invoice on record for this decision: nothing is attached");

  return { skip: null, issues, fields, changes, warnings, note, attach };
}

module.exports = { BASIS_LABELS, skipReason, determinationNote, planContactWrite };

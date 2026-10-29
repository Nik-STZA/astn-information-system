// The client profile (Nik, 29 Oct 2026): the group, the companies in it and
// the facts an agent needs before it can choose a treatment - who owns whom,
// where each company is incorporated, its VAT position and the reporting
// standard it reports under.
//
// A company is a finance.entities row, connected to Xero or not. The group is
// the client: its VAT group registration lives on shared.clients (migration
// 030). This file holds the rules; server.js reads and writes.

const FRAMEWORKS = ["FRS 105", "FRS 102 Section 1A", "FRS 102", "IFRS", "IFRS for SMEs", "US GAAP", "Other"];

// What each framework decides that agents most often get wrong. Shown to an
// agent with the profile so it does not have to remember.
const FRAMEWORK_NOTES = {
  "FRS 105": "Micro-entity: no lessee right-of-use model, no deferred tax, no revaluation, minimal disclosure.",
  "FRS 102 Section 1A": "Small company under FRS 102: FRS 102 recognition and measurement, reduced disclosure.",
  "FRS 102": "UK GAAP: receivables impairment is incurred loss (section 11); leases on balance sheet for lessees from 1 January 2026; development costs a policy choice (section 18).",
  "IFRS": "Receivables impairment is expected credit loss (IFRS 9); lessee leases on balance sheet (IFRS 16); development costs capitalised when the IAS 38 criteria are met.",
  "IFRS for SMEs": "Simplified IFRS: incurred loss for basic financial instruments; development costs expensed in the current edition unless the client's policy says otherwise.",
  "US GAAP": "Current expected credit loss (ASC 326); leases under ASC 842; development costs generally expensed (ASC 730). Check the client's policies before applying UK practice.",
  "Other": "Not one of the standard frameworks: read the client's rules before choosing any treatment.",
};

const TEXT = { name: 120, legal_name: 200, company_number: 40, registered_address: 500, vat_number: 40 };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const clean = (v) => (blank(v) ? null : String(v).trim());
const names = (list) => list.map((c) => c.name).join(", ").replace(/, ([^,]*)$/, " and $1");

// A VAT number in one form: no spaces, upper case, and a UK number (9 or 12
// digits) with its GB prefix, as HMRC and Xero write it. Others as given.
function vatNumber(v, uk) {
  if (blank(v)) return null;
  const n = String(v).replace(/\s+/g, "").toUpperCase();
  return uk && /^(\d{9}|\d{12})$/.test(n) ? `GB${n}` : n;
}
const ukGroup = (companies) => companies.some((c) => c.country_of_incorporation === "GB");

// The profile with every VAT number in that form, for reading. Numbers saved
// before the GB prefix was added read the same as those saved after.
function normalise(group, companies) {
  return {
    group: { ...group, vat_group_number: vatNumber(group.vat_group_number, ukGroup(companies)) },
    companies: companies.map((c) => ({ ...c, vat_number: vatNumber(c.vat_number, c.country_of_incorporation === "GB") })),
  };
}

// A change to one company. `companies` is every company of the same client,
// for the parent checks. Returns { set, issues }; set holds only fields sent.
function companyChanges(body = {}, current = null, companies = []) {
  const set = {};
  const issues = [];

  for (const [k, max] of Object.entries(TEXT)) {
    if (!(k in body)) continue;
    const v = clean(body[k]);
    if (k === "name" && !v) { issues.push("A company needs a name."); continue; }
    if (v && v.length > max) { issues.push(`${k.replace(/_/g, " ")} is longer than ${max} characters.`); continue; }
    set[k] = v;
  }
  if (!current && !("name" in body)) issues.push("A company needs a name.");

  if ("country_of_incorporation" in body) {
    const v = clean(body.country_of_incorporation);
    if (v && !COUNTRY.test(v.toUpperCase())) issues.push("Country of incorporation must be a two-letter code, such as GB or ZA.");
    else set.country_of_incorporation = v ? v.toUpperCase() : null;
  }
  if (set.vat_number) {
    set.vat_number = vatNumber(set.vat_number, (set.country_of_incorporation ?? current?.country_of_incorporation) === "GB");
  }
  if ("reporting_framework" in body) {
    const v = clean(body.reporting_framework);
    if (v && !FRAMEWORKS.includes(v)) issues.push(`Reporting standard must be one of ${FRAMEWORKS.join(", ")}.`);
    else set.reporting_framework = v;
  }
  if ("year_end" in body) {
    const v = clean(body.year_end);
    if (v && (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) issues.push("Year end must be a date (YYYY-MM-DD).");
    else set.year_end = v;
  }
  if ("in_vat_group" in body) {
    if (typeof body.in_vat_group !== "boolean") issues.push("In the VAT group must be true or false.");
    else set.in_vat_group = body.in_vat_group;
  }
  if ("ownership_pct" in body) {
    const v = blank(body.ownership_pct) ? null : Number(body.ownership_pct);
    if (v !== null && (!Number.isFinite(v) || v <= 0 || v > 100)) issues.push("Ownership must be a percentage above 0 and up to 100.");
    else set.ownership_pct = v;
  }
  if ("parent_id" in body) {
    const v = clean(body.parent_id);
    if (v) {
      const parent = companies.find((c) => c.id === v);
      if (!parent) issues.push("The parent must be another company of this client.");
      else if (current && v === current.id) issues.push("A company cannot be its own parent.");
      else if (current && ancestors(v, companies).includes(current.id)) issues.push(`${parent.name} is already owned, directly or through others, by this company.`);
      else set.parent_id = v;
    } else {
      set.parent_id = null;
    }
  }
  return { set, issues };
}

// The chain of parents above a company, nearest first.
function ancestors(id, companies) {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const out = [];
  let at = byId.get(id)?.parent_id;
  while (at && !out.includes(at)) { out.push(at); at = byId.get(at)?.parent_id; }
  return out;
}

// A change to the group's VAT registration.
function groupChanges(body = {}, companies = []) {
  const set = {};
  const issues = [];
  if ("vat_group" in body) {
    if (typeof body.vat_group !== "boolean") issues.push("VAT group must be true or false.");
    else set.vat_group = body.vat_group;
  }
  if ("vat_group_number" in body) {
    const v = clean(body.vat_group_number);
    if (v && v.length > 40) issues.push("The VAT group number is longer than 40 characters.");
    else set.vat_group_number = vatNumber(v, ukGroup(companies));
  }
  if ("vat_group_representative_id" in body) {
    const v = clean(body.vat_group_representative_id);
    if (v && !companies.some((c) => c.id === v)) issues.push("The representative member must be one of this client's companies.");
    else set.vat_group_representative_id = v;
  }
  return { set, issues };
}

// The companies as a tree, parents first, each with its depth.
function tree(companies) {
  const ids = new Set(companies.map((c) => c.id));
  const kids = (pid) => companies.filter((c) => (c.parent_id && ids.has(c.parent_id) ? c.parent_id : null) === pid)
    .sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  const walk = (pid, depth) => { for (const c of kids(pid)) { out.push({ ...c, depth }); walk(c.id, depth + 1); } };
  walk(null, 0);
  return out;
}

// What is missing or inconsistent, in words for a person and an agent. These
// are warnings, never refusals: a half-filled profile is still worth saving.
function profileIssues(rawGroup, rawCompanies) {
  const { group, companies } = normalise(rawGroup, rawCompanies);
  const out = [];
  const tops = companies.filter((c) => !c.parent_id);
  if (companies.length > 1 && tops.length > 1) {
    // The likeliest parent is the one that already owns something.
    const parent = tops.find((t) => companies.some((c) => c.parent_id === t.id)) ?? tops[0];
    const rest = tops.filter((t) => t !== parent);
    out.push(`No single parent company: ${names(tops)} have no parent recorded. The group's parent needs none; ` +
      `if ${parent.name} owns ${names(rest)}, set ${rest.length > 1 ? "their" : "its"} parent to ${parent.name}.`);
  }
  for (const c of companies) {
    if (!c.reporting_framework) out.push(`${c.name}: no reporting standard. Agents will ask before choosing a treatment.`);
    if (!c.country_of_incorporation) out.push(`${c.name}: no country of incorporation.`);
    if (c.in_vat_group && !group.vat_group) out.push(`${c.name} is ticked as in the VAT group, but the group has no VAT group registration.`);
    if (c.in_vat_group && group.vat_group && c.vat_number && group.vat_group_number && c.vat_number !== group.vat_group_number) {
      out.push(`${c.name} is in the VAT group but carries its own VAT number ${c.vat_number}; a group member uses the group's number.`);
    }
  }
  if (group.vat_group) {
    if (!group.vat_group_number) out.push("The VAT group has no registration number.");
    if (!companies.some((c) => c.in_vat_group)) out.push("The VAT group has no member companies ticked.");
    const rep = companies.find((c) => c.id === group.vat_group_representative_id);
    if (!group.vat_group_representative_id) out.push("The VAT group has no representative member.");
    else if (rep && !rep.in_vat_group) out.push(`${rep.name} is the VAT group's representative member but is not ticked as a member.`);
  }
  const frameworks = new Set(companies.map((c) => c.reporting_framework).filter(Boolean));
  if (frameworks.size > 1) out.push(`The companies report under different standards (${[...frameworks].join(", ")}). Consolidation adjustments may be needed.`);
  return out;
}

// Why a company cannot be retired yet, if it cannot. companies are the live
// companies of the same client.
function retireIssues(c, companies, group) {
  const issues = [];
  if (c.connected) issues.push(`${c.name} is connected to Xero. Disconnect it on the Finance set-up before retiring it.`);
  const owned = companies.filter((x) => x.parent_id === c.id);
  if (owned.length) issues.push(`${c.name} owns ${names(owned)}. Give ${owned.length > 1 ? "them" : "it"} another parent first.`);
  if (group.vat_group_representative_id === c.id) issues.push(`${c.name} is the VAT group's representative member. Choose another first.`);
  return issues;
}

// One company's VAT position in a sentence, for an agent.
function vatPosition(c, group) {
  if (group.vat_group && c.in_vat_group) {
    return `Member of the VAT group${group.vat_group_number ? ` ${group.vat_group_number}` : ""}${group.vat_group_representative_id === c.id ? " (representative member)" : ""}.`;
  }
  if (c.vat_number) return `Registered on its own, VAT number ${c.vat_number}.`;
  return "No VAT number recorded. Check get_organisation before treating it as unregistered.";
}

// The profile as an agent reads it. lastChanged is when a person last changed
// it, so an agent asked twice can tell a changed record from its own mistake.
function agentView(client, rawGroup, rawCompanies, lastChanged = null) {
  const { group, companies } = normalise(rawGroup, rawCompanies);
  const byId = new Map(companies.map((c) => [c.id, c]));
  return {
    client: client.name,
    legal_name: client.legal_name,
    profile_last_changed: lastChanged,
    vat_group: group.vat_group
      ? { number: group.vat_group_number, representative: byId.get(group.vat_group_representative_id)?.name ?? null, members: companies.filter((c) => c.in_vat_group).map((c) => c.name) }
      : null,
    companies: tree(companies).map((c) => ({
      name: c.name, slug: c.slug, legal_name: c.legal_name, company_number: c.company_number,
      country_of_incorporation: c.country_of_incorporation, registered_address: c.registered_address,
      parent: c.parent_id ? byId.get(c.parent_id)?.name ?? null : null, ownership_pct: c.ownership_pct === null ? null : Number(c.ownership_pct),
      reporting_framework: c.reporting_framework, framework_note: c.reporting_framework ? FRAMEWORK_NOTES[c.reporting_framework] : null,
      vat: vatPosition(c, group), year_end: c.year_end, connected_to_xero: Boolean(c.connected),
    })),
    gaps: profileIssues(group, companies),
  };
}

module.exports = { FRAMEWORKS, FRAMEWORK_NOTES, companyChanges, groupChanges, ancestors, tree, profileIssues, vatPosition, agentView, vatNumber, normalise, retireIssues };

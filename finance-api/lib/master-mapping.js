// Master mapping file upload (part 3 of docs/management-pack-templates-plan.md).
//
// A master file is the client's own chart of accounts mapping, group wide: one
// row per account with its code, name, Xero type, P&L Mapping 1 (the heading),
// P&L Mapping 2 (the sub-line) and BS Mapping. The browser reads the file into
// rows; everything here is pure, so finance-api plans the same thing for the
// preview and again, from scratch, when the CFO applies it.
//
// Each company's Xero accounts are matched to master rows on code and name
// together (the master's "code - name" key). A row whose code matches but whose
// name does not is reported, never applied: the account may have been renamed
// or recoded since the master was written. Headings are translated through the
// client's pack template (lib/pack-templates.js); a heading the template does
// not know is reported, never guessed.

const { statementOfClass } = require("./coa-mapping");
const { categoriesForHeading } = require("./pack-templates");

const HEADER_ALIASES = {
  code: ["*code", "code", "account code"],
  name: ["*name", "name", "account", "account name"],
  type: ["*type", "type", "account type"],
  pnl1: ["p&l mapping 1", "pnl mapping 1", "p&l heading"],
  pnl2: ["p&l mapping 2", "pnl mapping 2", "p&l sub-line", "p&l subline"],
  bs: ["bs mapping", "balance sheet mapping"],
};

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const norm = (v) => clean(v).toLowerCase();

// The header row (the first in the first 20 that names a code and a mapping
// column) and the rows under it, as { code, name, type, pnl1, pnl2, bs, row }.
function readMasterTable(table) {
  const errors = [];
  if (!Array.isArray(table) || !table.length) return { rows: [], errors: ["The file has no rows"] };
  let headAt = -1;
  let cols = null;
  for (let i = 0; i < Math.min(table.length, 20); i++) {
    const head = (table[i] || []).map(norm);
    const found = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
    if (found.name >= 0 && (found.pnl1 >= 0 || found.bs >= 0)) {
      headAt = i;
      cols = found;
      break;
    }
  }
  if (!cols) {
    return { rows: [], errors: ["No header row found: the file needs Name and P&L Mapping 1 or BS Mapping columns (Code, Type and P&L Mapping 2 too, ideally)"] };
  }
  const get = (line, k) => (cols[k] >= 0 ? clean(line[cols[k]]) : "");
  const rows = [];
  table.slice(headAt + 1).forEach((line, i) => {
    const r = { code: get(line, "code"), name: get(line, "name"), type: get(line, "type"), pnl1: get(line, "pnl1"), pnl2: get(line, "pnl2"), bs: get(line, "bs"), row: headAt + i + 2 };
    if (!r.name && !r.code) return;
    rows.push(r);
  });
  if (rows.length > 5000) errors.push("The file has more than 5,000 rows; split it");
  return { rows, errors };
}

const keyOf = (code, name) => `${norm(code)}|${norm(name)}`;
const ASSET_SECTIONS = new Set(["fixed_assets", "current_assets"]);
const LIABILITY_SECTIONS = new Set(["creditors_lt1y", "creditors_gt1y", "provisions"]);

// Which of a heading's lines this account takes: the one it is on, if allowed;
// else the first that suits its Xero class (an asset is not put in creditors).
function choose(options, account, saved, categories) {
  const live = options.filter((k) => categories.get(k)?.active);
  if (saved && live.includes(saved.category_key)) return saved.category_key;
  const klass = String(account.Class || "").toUpperCase();
  const fits = (k) => {
    const s = categories.get(k).section;
    if (klass === "ASSET") return ASSET_SECTIONS.has(s);
    if (klass === "LIABILITY") return LIABILITY_SECTIONS.has(s);
    if (klass === "EQUITY") return s === "equity";
    return true;
  };
  return live.find(fits) ?? live[0] ?? options[0];
}

// rows: readMasterTable's rows. entities: [{ slug, name, accounts (Xero),
// stored: Map(accountId -> saved mapping) }]. categories: the client's
// effective categories. Returns, per entity, the changes it would make and
// what it cannot decide, plus the master rows no company has.
function planMaster({ rows, template, categories, entities, approve = false }) {
  const byKey = new Map();
  const duplicates = [];
  for (const r of rows) {
    const k = keyOf(r.code, r.name);
    const prev = byKey.get(k);
    if (prev && (norm(prev.pnl1) !== norm(r.pnl1) || norm(prev.pnl2) !== norm(r.pnl2) || norm(prev.bs) !== norm(r.bs))) {
      duplicates.push({ code: r.code, name: r.name, rows: [prev.row, r.row] });
      prev.conflict = true;
      continue;
    }
    if (!prev) byKey.set(k, { ...r });
  }
  const byCode = new Map();
  for (const r of byKey.values()) {
    if (!r.code) continue;
    byCode.set(norm(r.code), [...(byCode.get(norm(r.code)) ?? []), r]);
  }

  const used = new Set();
  const out = entities.map((e) => {
    const changes = [];
    const nameDiffers = [];
    const noHeading = [];
    const unknownHeading = [];
    const notInMaster = [];
    let unchanged = 0;
    for (const a of e.accounts) {
      const r = byKey.get(keyOf(a.Code, a.Name));
      const label = a.Code ? `${a.Code} ${a.Name}` : a.Name;
      if (!r) {
        const sameCode = a.Code ? byCode.get(norm(a.Code)) : null;
        if (sameCode?.length) {
          sameCode.forEach((x) => used.add(keyOf(x.code, x.name)));
          nameDiffers.push({ accountId: a.AccountID, code: a.Code, xeroName: a.Name, masterName: sameCode.map((x) => x.name).join(" / ") });
        } else if (String(a.Status || "ACTIVE").toUpperCase() === "ACTIVE") {
          notInMaster.push({ accountId: a.AccountID, code: a.Code ?? null, name: a.Name, class: a.Class });
        }
        continue;
      }
      used.add(keyOf(r.code, r.name));
      if (r.conflict) continue;   // reported once, under duplicates
      const statement = statementOfClass(a.Class);
      const heading = statement === "pnl" ? r.pnl1 : r.bs;
      if (!heading) {
        noHeading.push({ accountId: a.AccountID, code: a.Code ?? null, name: a.Name, statement, row: r.row });
        continue;
      }
      const options = categoriesForHeading(template, statement, heading);
      if (!options.length) {
        unknownHeading.push({ accountId: a.AccountID, code: a.Code ?? null, name: a.Name, statement, heading, row: r.row });
        continue;
      }
      const saved = e.stored.get(a.AccountID) || null;
      const category = choose(options, a, saved, categories);
      const cat = categories.get(category);
      if (!cat || !cat.active || cat.statement !== statement) {
        unknownHeading.push({ accountId: a.AccountID, code: a.Code ?? null, name: a.Name, statement, heading, row: r.row,
          why: !cat ? `${heading} means ${category}, which this client does not have` : !cat.active ? `${cat.label} is switched off` : `${cat.label} is on the other statement` });
        continue;
      }
      const subline = statement === "pnl" ? (r.pnl2 || null) : null;
      const from = saved ? { category: saved.category_key, subline: saved.subline ?? null, status: saved.status } : null;
      const same = from && from.category === category && (from.subline ?? null) === subline && (!approve || from.status === "approved");
      if (same) { unchanged += 1; continue; }
      changes.push({
        accountId: a.AccountID, code: a.Code ?? null, name: a.Name, statement, heading, row: r.row,
        from, to: { category, label: cat.label, subline },
        kind: !from ? "new" : from.category !== category ? "category" : (from.subline ?? null) !== subline ? "subline" : "approve",
      });
    }
    return { slug: e.slug, name: e.name, changes, unchanged, nameDiffers, noHeading, unknownHeading, notInMaster };
  });

  const unmatched = [...byKey.values()].filter((r) => !used.has(keyOf(r.code, r.name)))
    .map((r) => ({ code: r.code || null, name: r.name, row: r.row }));
  return { entities: out, unmatched, duplicates, rows: rows.length };
}

// The changes to save for one entity, less what the CFO unticked
// (exclude: ["<entity>:<accountId>", ...]).
function changesToApply(entityPlan, exclude, approve) {
  const skip = new Set(exclude || []);
  return entityPlan.changes
    .filter((c) => !skip.has(`${entityPlan.slug}:${c.accountId}`))
    .map((c) => ({ accountId: c.accountId, category: c.to.category, subline: c.to.subline, approve: Boolean(approve) }));
}

module.exports = { readMasterTable, planMaster, changesToApply, HEADER_ALIASES };

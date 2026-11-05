// Proposed changes to Xero other than journals (migration 039): what each kind
// is, who may propose it, how a proposal becomes the body of its gated write
// route, and how that route's answer is read. Pure, so it is tested without
// Xero or a database; lib/xero-changes-routes.js applies it.
//
// Nik's rule (5 Nov 2026): agents can do what Cowork can. A write reaches the
// agents as a proposal the CFO approves in os.stza.io; finance-api then makes
// it through the same route Cowork calls (tier, validation, confirmation code,
// audit), so there is one way into the ledger. lib/agent-parity.js lists the
// writes still to come; each joins by adding a kind here.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isGuid = (s) => GUID.test(String(s ?? ""));

function isDate(s) {
  if (!DATE.test(String(s ?? ""))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const text = (v) => (v === undefined || v === null ? "" : String(v).trim());
const money2 = (n) => Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// The depreciation fields an asset copies from its type, when the type has them.
const DEPRECIATION_FIELDS = ["depreciationMethod", "averagingMethod", "depreciationRate", "effectiveLifeYears", "depreciationCalculationMethod"];
const METHODS = ["NoDepreciation", "StraightLine", "DiminishingValue100", "DiminishingValue150", "DiminishingValue200", "FullDepreciation"];

// The next free asset number in the register's own pattern: FA-0010 after
// FA-0009. The prefix and width are the most common ones already used, so a
// register numbered COMP-001 carries on as COMP-002. An empty register starts
// at FA-0001, Xero's own default.
function nextAssetNumber(numbers) {
  const parsed = (numbers || []).map((n) => /^(.*?)(\d+)$/.exec(String(n ?? "").trim())).filter(Boolean)
    .map((m) => ({ prefix: m[1], width: m[2].length, n: Number(m[2]) }));
  if (!parsed.length) return "FA-0001";
  const tally = new Map();
  for (const p of parsed) tally.set(`${p.prefix}|${p.width}`, (tally.get(`${p.prefix}|${p.width}`) ?? 0) + 1);
  const [key] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const [prefix, width] = [key.split("|")[0], Number(key.split("|")[1])];
  const max = Math.max(...parsed.filter((p) => p.prefix === prefix).map((p) => p.n));
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

// ── Fixed assets ─────────────────────────────────────────────────────────────

// A proposal for one asset, from the purchase that bought it, checked against
// the register as Xero holds it: { types, numbers, assets } read just before.
// Returns { issues, warnings, input, summary } where input is exactly the body
// of POST .../write/fixed-assets the CFO's approval sends.
function fixedAssetProposal(body, register) {
  const issues = [];
  const warnings = [];
  const b = body || {};
  const name = text(b.asset_name);
  if (!name) issues.push("asset_name is required");
  if (name.length > 255) issues.push("asset_name is too long");
  if (!isDate(b.purchase_date)) issues.push("purchase_date must be a date, YYYY-MM-DD");
  const price = Number(b.purchase_price);
  if (b.purchase_price === undefined || b.purchase_price === null || b.purchase_price === "" || !Number.isFinite(price) || price <= 0) {
    issues.push("purchase_price must be more than 0");
  } else if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
    issues.push("purchase_price has more than 2 decimal places");
  }
  if (!isGuid(b.asset_type_id)) issues.push("asset_type_id must be the id of an asset type (get_fixed_assets what=types)");
  if (b.depreciation_start_date !== undefined && b.depreciation_start_date !== "" && !isDate(b.depreciation_start_date)) {
    issues.push("depreciation_start_date must be a date, YYYY-MM-DD");
  }
  if (b.warranty_expiry !== undefined && b.warranty_expiry !== "" && !isDate(b.warranty_expiry)) issues.push("warranty_expiry must be a date, YYYY-MM-DD");
  if (b.depreciation_method !== undefined && b.depreciation_method !== "" && !METHODS.includes(b.depreciation_method)) {
    issues.push(`depreciation_method must be one of ${METHODS.join(", ")}`);
  }
  if (b.effective_life_years !== undefined && b.effective_life_years !== "" && !(Number.isInteger(Number(b.effective_life_years)) && Number(b.effective_life_years) > 0)) {
    issues.push("effective_life_years must be a whole number of years");
  }
  if (b.source_doc !== undefined && b.source_doc !== "" && !isGuid(b.source_doc)) issues.push("source_doc must be the id of the Xero bill or bank transaction that bought it");
  if (!text(b.reason)) issues.push("reason is required: what was bought, the document it is on, and why it is an asset");
  if (issues.length) return { issues, warnings };

  const type = (register?.types || []).find((t) => String(t.assetTypeId).toLowerCase() === String(b.asset_type_id).toLowerCase());
  if (!type) return { issues: [`No asset type ${b.asset_type_id} in this company's register. Read the types with get_fixed_assets what=types.`], warnings };

  // The same purchase already in the register, at any status.
  const same = (register?.assets || []).find((a) =>
    String(a.purchaseDate ?? "").slice(0, 10) === b.purchase_date && Math.abs(Number(a.purchasePrice) - price) < 0.005);
  if (same && b.allow_duplicate !== true) {
    return { issues: [`The register already has ${same.assetNumber ?? ""} ${same.assetName ?? ""} (${same.assetStatus ?? "unknown status"}) bought on ${b.purchase_date} for ${money2(price)}. If this is a second asset, propose again with allow_duplicate true and say why.`.replace(/\s+/g, " ")], warnings };
  }

  const number = text(b.asset_number) || nextAssetNumber(register?.numbers);
  if ((register?.numbers || []).some((n) => String(n).toLowerCase() === number.toLowerCase())) {
    return { issues: [`Asset number ${number} is already used in this register`], warnings };
  }

  const fromType = type.bookDepreciationSetting || {};
  const setting = {};
  for (const f of DEPRECIATION_FIELDS) if (fromType[f] !== undefined && fromType[f] !== null) setting[f] = fromType[f];
  if (text(b.depreciation_method)) setting.depreciationMethod = b.depreciation_method;
  if (text(b.effective_life_years)) { setting.effectiveLifeYears = Number(b.effective_life_years); delete setting.depreciationRate; }
  if (!setting.depreciationMethod) warnings.push(`The ${type.assetTypeName} type has no depreciation method, so the asset will need one before it is registered in Xero.`);

  const record = {
    assetName: name,
    assetNumber: number,
    assetTypeId: type.assetTypeId,
    purchaseDate: b.purchase_date,
    purchasePrice: Math.round(price * 100) / 100,
    // Draft: a person registers it in Xero, which starts its depreciation.
    assetStatus: "Draft",
    bookDepreciationDetail: { depreciationStartDate: text(b.depreciation_start_date) || b.purchase_date },
  };
  if (Object.keys(setting).length) record.bookDepreciationSetting = setting;
  if (text(b.description)) record.description = text(b.description);
  if (text(b.serial_number)) record.serialNumber = text(b.serial_number);
  if (text(b.warranty_expiry)) record.warrantyExpiryDate = text(b.warranty_expiry);

  return {
    issues: [],
    warnings,
    input: { what: "asset", record, audit_note: `Proposed asset ${number}, approved by the CFO in os.stza.io` },
    summary: `${number} ${name}, ${type.assetTypeName}, bought ${dayLabel(b.purchase_date)}, ${money2(price)}`,
    duplicate_key: `${b.purchase_date}|${Math.round(price * 100)}`,
  };
}

// ── The kinds ────────────────────────────────────────────────────────────────

// route: the gated write route under /xero/:entity/write/ that makes it.
// tool: its name in Cowork and in the audit log. needs: what the proposal
// route reads from Xero first.
const KINDS = {
  create_fixed_asset: {
    route: "fixed-assets",
    tier: "setup",
    proposers: ["fm1", "fc"],
    label: "Fixed asset",
    needs: "asset_register",
    propose: fixedAssetProposal,
    // What Xero made, from the write route's answer.
    madeId: (body) => body?.assetId ?? null,
    after: "In Xero's register as a draft. Register it there to start its depreciation.",
  },
};

const isKind = (k) => Object.prototype.hasOwnProperty.call(KINDS, k);

// The Xero idempotency key of one attempt, as journals do: moves on only after
// Xero definitely refused the last one.
const changeKey = (c) => `xero-change-${c.id}-${c.attempts}`;

// What a gated write's answer means for the change.
//   written   Xero made it
//   refused   it did not reach Xero, or Xero answered no: safe to try again
//   unknown   it may be in Xero: someone must look before anything else
function outcomeOf({ status, body }) {
  if (status === 201 && (body?.action === "WRITTEN" || body?.action === "UPDATED")) return "written";
  if (status === 422 || status === 400 || status === 403 || status === 404) return "refused";
  if (status === 502 && Number(body?.http_status) >= 400 && Number(body?.http_status) < 500) return "refused";
  return "unknown";
}

function failureText({ status, body }) {
  const said = [].concat(body?.issues || [], body?.xero_errors || []).filter(Boolean);
  if (said.length) return said.join(" ");
  if (body?.error) return String(body.error);
  return `Xero did not give a clear answer (${status}).`;
}

// The tier switch, read from the company's own write policy (lib/xero-write.js
// writePolicy), so a proposal can say up front that approving will be refused.
function tierWarning(kind, policy, companyName) {
  const k = KINDS[kind];
  if (!k || policy?.[k.tier]) return null;
  return `Xero changes of this kind (the ${k.tier} tier) are switched off for ${companyName}, so approving will be refused until they are switched on.`;
}

module.exports = { KINDS, isKind, isGuid, isDate, nextAssetNumber, fixedAssetProposal, changeKey, outcomeOf, failureText, tierWarning };

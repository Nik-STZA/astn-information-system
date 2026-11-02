// The balance sheet matrix as data: who owns each line, what proves it, and
// whether it is mechanical (M) or judgement (J). From the balance-sheet-matrix
// procedure, and used by scripts/compose-matrix.mjs and the reconciliations.
//
// Owner, challenge, artefact and class are properties of the LINE, not of the
// client: the client's trial balance decides only which lines appear. The class
// drives approval routing, so it is set here and never by an agent about its
// own work.
//
// proof is how a reconciliation proves the line: a schedule held in os.stza.io,
// evidence from outside the ledger, or a review of the ledger itself.

const LINES = [
  { key: "cash", line: "Cash and bank", owner: "FM2", challenge: "-", artefact: "Bank reconciliation per account", cadence: "Monthly", cls: "M", proof: "outside_evidence" },
  { key: "ar", line: "Accounts receivable", owner: "AR Clerk", challenge: "FM2", artefact: "Subledger-to-GL tie, ageing, statement recs", cadence: "Monthly", cls: "M", proof: "outside_evidence" },
  { key: "baddebt", line: "Bad debt provision", owner: "AR Clerk", challenge: "FC", artefact: "Provision schedule by ageing band", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "contractasst", line: "Contract assets / accrued income", owner: "FM1", challenge: "FC", artefact: "Unbilled schedule by contract", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "stock", line: "Stock", owner: "FM1", challenge: "FC", artefact: "Subledger tie, book-to-physical, ageing", cadence: "Monthly", cls: "M", proof: "outside_evidence" },
  { key: "prepay", line: "Prepayments", owner: "FM1", challenge: "-", artefact: "Prepayment schedule with release profile", cadence: "Monthly", cls: "M", proof: "schedule" },
  { key: "ppe", line: "Tangible assets", owner: "FM1", challenge: "-", artefact: "Fixed asset register", cadence: "Monthly", cls: "M", proof: "schedule" },
  { key: "rou", line: "Right-of-use assets (lessee)", owner: "FM1", challenge: "FC", artefact: "Lease register, lessee section", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "intangible", line: "Intangible assets", owner: "FM1", challenge: "FC", artefact: "FAR intangibles, memo per project", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "investments", line: "Investments", owner: "FM1", challenge: "FC", artefact: "Investment schedule: cost, additions, impairment review", cadence: "Annual and on event", cls: "J", proof: "schedule" },
  { key: "ic_asset", line: "Intercompany receivables", owner: "FM1", challenge: "FC", artefact: "IC matrix, both sides agreed", cadence: "Monthly", cls: "M", proof: "ledger_review" },
  { key: "ap", line: "Trade payables", owner: "AP Clerk", challenge: "FM2", artefact: "Subledger tie, supplier statement recs", cadence: "Monthly", cls: "M", proof: "outside_evidence" },
  { key: "grni", line: "Goods received not invoiced", owner: "AP Clerk", challenge: "FM1", artefact: "GRNI listing with ageing", cadence: "Monthly", cls: "M", proof: "ledger_review" },
  { key: "accruals", line: "Accruals", owner: "FM1", challenge: "FC", artefact: "Accruals listing with basis", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "vat", line: "VAT control", owner: "FM1", challenge: "FM2", artefact: "VAT return reconciliation to control", cadence: "Per return", cls: "M", proof: "outside_evidence" },
  { key: "payroll", line: "Payroll control", owner: "FM1", challenge: "FC", artefact: "Payroll control reconciliation", cadence: "Monthly", cls: "M", proof: "outside_evidence" },
  { key: "deposits", line: "Customer deposits", owner: "AR Clerk", challenge: "FM1", artefact: "Deposit register by order", cadence: "Monthly", cls: "M", proof: "outside_evidence" },
  { key: "deferred", line: "Deferred income", owner: "FM1", challenge: "FC", artefact: "Deferred income waterfall tied to control", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "lease_liab", line: "Lease liabilities", owner: "FM1", challenge: "FC", artefact: "Lease register, both sides tie", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "provisions", line: "Provisions", owner: "FM1", challenge: "FC", artefact: "Provisions register, movements schedule", cadence: "Monthly movements", cls: "J", proof: "schedule" },
  { key: "loans", line: "External finance and loans", owner: "FP&A", challenge: "FC", artefact: "Debt register, effective interest schedules", cadence: "Monthly", cls: "M", proof: "outside_evidence" },
  { key: "cln", line: "Convertible loan notes", owner: "FP&A", challenge: "FC", artefact: "Debt register CLN section, classification memo", cadence: "Monthly", cls: "J", proof: "schedule" },
  { key: "ic_liab", line: "Intercompany payables", owner: "FM1", challenge: "FC", artefact: "IC matrix, both sides agreed", cadence: "Monthly", cls: "M", proof: "ledger_review" },
  { key: "tax", line: "Corporation tax and deferred tax", owner: "Referred to tax adviser", challenge: "FC", artefact: "Adviser computation; practice reconciles the balance", cadence: "Per return", cls: "J", proof: "outside_evidence" },
  { key: "sharecap", line: "Share capital", owner: "FC", challenge: "CFO", artefact: "Equity register tied to Companies House", cadence: "On event", cls: "J", proof: "outside_evidence" },
  { key: "premium", line: "Share premium", owner: "FC", challenge: "CFO", artefact: "Equity register", cadence: "On event", cls: "J", proof: "outside_evidence" },
  { key: "reserves", line: "Reserves and retained earnings", owner: "FC", challenge: "CFO", artefact: "Reserves movement schedule", cadence: "Monthly", cls: "M", proof: "ledger_review" },
];

// Xero's SystemAccount is the most reliable signal, because it is set by Xero
// rather than typed by whoever built the chart. Name patterns are a fallback and
// anything they do not catch is reported unplaced rather than guessed at.
const BY_SYSTEM_ACCOUNT = {
  DEBTORS: "ar", CREDITORS: "ap", RETAINEDEARNINGS: "reserves",
  GST: "vat", GSTONIMPORTS: "vat", WAGEPAYABLES: "payroll",
  UNPAIDEXPCLM: "accruals", UNASSIGNEDEXPCLM: "accruals",
};

const BY_NAME = [
  [/^bank|current account|savings|deposit account|paypal|stripe balance/i, "cash"],
  [/vat|gst\b/i, "vat"],
  [/prepay/i, "prepay"],
  [/accrual/i, "accruals"],
  [/deferred (income|revenue)/i, "deferred"],
  [/customer deposit|payments? on account|payments? received on account/i, "deposits"],
  [/stock|inventor/i, "stock"],
  [/right.of.use|rou asset/i, "rou"],
  [/lease liab/i, "lease_liab"],
  [/convertible/i, "cln"],
  [/loan|borrowing|facility/i, "loans"],
  [/intercompany|inter.company/i, "ic_asset"],
  [/share premium/i, "premium"],
  [/share capital|ordinary shares/i, "sharecap"],
  [/corporation tax|deferred tax/i, "tax"],
  [/provision/i, "provisions"],
  [/payroll|wages payable|paye|nic /i, "payroll"],
  [/investment in|shares in (subsidiar|associate)/i, "investments"],
  [/retained earnings/i, "reserves"],
  [/doubtful debt|bad debt/i, "baddebt"],
  [/nic payable|national insurance|paye payable/i, "payroll"],
  [/goodwill|intangible|capitalised development|software (asset|development)/i, "intangible"],
  [/accumulated depreciation|fixed asset|equipment|furniture|computer|plant|tooling|motor vehicle/i, "ppe"],
];

const BY_TYPE = { BANK: "cash", FIXED: "ppe", INVENTORY: "stock", EQUITY: "sharecap" };

function classify(account) {
  if (account.SystemAccount && BY_SYSTEM_ACCOUNT[account.SystemAccount]) {
    return { key: BY_SYSTEM_ACCOUNT[account.SystemAccount], how: `system account ${account.SystemAccount}` };
  }
  for (const [re, key] of BY_NAME) {
    if (re.test(account.Name || "")) return { key, how: `name matched ${re}` };
  }
  if (BY_TYPE[account.Type]) return { key: BY_TYPE[account.Type], how: `type ${account.Type}` };
  return null;
}

const lineFor = (key) => LINES.find((l) => l.key === key) ?? null;

module.exports = { LINES, classify, lineFor };

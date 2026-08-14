// Pure decision logic for posting a manual journal.
//
// Separated from server.js so every rule can be tested without a network, a
// database or a Xero account. This file decides whether a journal is allowed to
// reach a client's ledger, so the failures here are the expensive kind: a
// journal that posts to the wrong company, in a closed period, unbalanced, or
// twice. See docs/xero-write-path/xero-write-path-spec.md.

const { createHash } = require("crypto");

// Money is handled in integer pence throughout. A journal that balances to
// 0.00000000001 is not balanced, and float addition produces exactly that.

/**
 * Parses an amount into integer pence, or null if it is not a clean money
 * value.
 *
 * Rejects more than two decimal places rather than rounding. Xero would round
 * silently; a rejected journal is a question, a rounded one is a wrong number
 * nobody sees. Accepts a string or a number, because JSON callers send both.
 */
function toPence(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  // Number → string can produce exponent form for very large or small values,
  // which the regex would reject. That is the correct outcome: an amount that
  // needs scientific notation is not a journal line.
  const s = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;

  const [, sign, whole, frac = ""] = m;
  const pence = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(pence)) return null;
  return sign === "-" ? -pence : pence;
}

/** Formats integer pence back to a 2dp string for display and comparison. */
function fromPence(pence) {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Reduces a company name to comparable letters and digits.
 *
 * Drops punctuation, spacing and the company-type suffix, so the several forms
 * of one entity's name collapse together: "Feldspar Group Holdings Limited",
 * "feldspar-group-holdings" and "Feldspar Group Holdings" all become
 * "feldspargroupholdings". Used only to compare a name against text a human
 * wrote; never to choose which entity to post to, which is decided by slug.
 */
function normaliseCompanyName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\b(limited|ltd|plc|llp|inc)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in strict YYYY-MM-DD form. */
function isValidIsoDate(s) {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// An approval agreed long before the request was made was agreed to a different
// set of numbers, or to nothing the caller can still show.
const APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Checks that the text shown to the approver actually describes this journal.
 *
 * This is the only part of the approval model the platform can verify. It
 * cannot observe the Cowork conversation, so it cannot know that a human
 * agreed — but it can refuse to believe a `presented_text` that does not
 * mention the entity, the date, or the accounts being touched. That catches a
 * payload edited between presentation and submission, which is the one drift
 * an assertion model can detect on its own.
 *
 * Deliberately does NOT require the net or the line amounts. Callers format
 * money differently ("50,000.00", "£50,000", "50000.00") and a formatting
 * mismatch would block a legitimate, genuinely approved journal. Amounts are
 * reported as a warning instead, so drift is visible without being fatal.
 */
function checkApprovalText(presentedText, { entityNames = [], date, lines }) {
  const text = String(presentedText || "");
  const hay = text.toLowerCase();
  const missing = [];

  // Any known name for the entity will do. One entity legitimately answers to
  // several: the slug (feldspar-group-holdings), a short internal name (FGH),
  // the legal name, and the Xero tenant name (Feldspar Group Holdings Limited).
  // Text written for a human uses whichever reads naturally, and requiring one
  // specific form would reject genuinely approved journals — which a live dry
  // run caught on the first real attempt.
  //
  // Both sides are normalised to letters and digits with company suffixes
  // dropped, so "Feldspar Group Holdings" in the text matches the tenant name
  // "Feldspar Group Holdings Limited" and the slug "feldspar-group-holdings"
  // alike. Without that, the near-miss between a person's phrasing and the
  // registered name blocks the post — which is a false negative on the one
  // check that is supposed to catch real drift, and would train people to work
  // around it.
  const names = entityNames.filter(Boolean).map(String);
  const flatText = normaliseCompanyName(text);
  const entityOk = names.some((n) => {
    const flat = normaliseCompanyName(n);
    return flat.length >= 3 && flatText.includes(flat);
  });
  if (!entityOk) missing.push(`entity (expected one of: ${names.join(", ")})`);

  if (date && !hay.includes(String(date).toLowerCase())) missing.push(`date (${date})`);

  for (const code of new Set(lines.map((l) => String(l.account_code ?? "")))) {
    if (code && !text.includes(code)) missing.push(`account code ${code}`);
  }

  return missing;
}

/** Amounts are a warning, not a blocker. See checkApprovalText. */
function approvalAmountWarnings(presentedText, lines) {
  const flat = String(presentedText || "").replace(/,/g, "");
  const unseen = [];
  for (const l of lines) {
    const p = toPence(l.amount);
    if (p === null) continue;
    if (!flat.includes(fromPence(Math.abs(p)))) unseen.push(fromPence(Math.abs(p)));
  }
  return unseen;
}

/**
 * Runs every rule and returns all failures at once.
 *
 * Returning only the first failure means a caller fixes one thing, resubmits,
 * and discovers the next — which for a human approving a journal is several
 * round trips through an approval step that is supposed to be deliberate.
 *
 * `accounts` is the entity's chart of accounts from Xero, `lockDates` the
 * organisation's PeriodLockDate and EndOfYearLockDate, `now` the request time.
 */
function validateJournal(body, { accounts, lockDates = {}, now, entitySlug, entityName, entityNames, materialityGbp = 1 }) {
  // Callers may pass the full set of acceptable names, or just slug and name.
  const names = entityNames && entityNames.length ? entityNames : [entitySlug, entityName];
  const issues = [];
  const warnings = [];
  const add = (code, detail) => issues.push({ code, detail });

  const lines = Array.isArray(body.lines) ? body.lines : [];

  // ── shape ────────────────────────────────────────────────────────────────
  if (!body.narration || !String(body.narration).trim()) {
    add("NO_NARRATION", "narration is required");
  }
  if (!isValidIsoDate(body.date)) {
    add("DATE_FORMAT", `date must be a real date in YYYY-MM-DD form, got ${JSON.stringify(body.date)}`);
  }
  if (body.status !== undefined && !["DRAFT", "POSTED"].includes(body.status)) {
    add("BAD_STATUS", `status must be DRAFT or POSTED, got ${JSON.stringify(body.status)}`);
  }
  if (lines.length < 2) {
    add("NO_LINES", `at least 2 lines are required, got ${lines.length}`);
  }

  // ── money ────────────────────────────────────────────────────────────────
  let net = 0;
  let moneyClean = true;
  lines.forEach((l, i) => {
    const p = toPence(l.amount);
    if (p === null) {
      moneyClean = false;
      add("AMOUNT_PRECISION", `line ${i + 1}: amount ${JSON.stringify(l.amount)} is not a money value with at most 2 decimal places`);
      return;
    }
    if (p === 0) add("ZERO_AMOUNT", `line ${i + 1}: amount is zero`);
    net += p;
    if (!l.account_code && l.account_code !== 0) {
      add("MISSING_ACCOUNT_CODE", `line ${i + 1}: account_code is required`);
    }
  });

  // Only meaningful once every line parsed; otherwise the net is a guess.
  if (moneyClean && lines.length && net !== 0) {
    const debits = lines.reduce((a, l) => a + Math.max(toPence(l.amount) ?? 0, 0), 0);
    const credits = lines.reduce((a, l) => a + Math.min(toPence(l.amount) ?? 0, 0), 0);
    add(
      "UNBALANCED",
      `debits ${fromPence(debits)} != credits ${fromPence(-credits)}, net ${fromPence(net)}`
    );
  }

  // ── chart of accounts ────────────────────────────────────────────────────
  if (Array.isArray(accounts)) {
    const byCode = new Map(accounts.map((a) => [String(a.Code), a]));
    for (const [i, l] of lines.entries()) {
      const code = String(l.account_code ?? "");
      if (!code) continue;
      const acct = byCode.get(code);
      if (!acct) {
        add("UNKNOWN_ACCOUNT", `line ${i + 1}: account code ${code} does not exist in ${names.filter(Boolean)[0] ?? "this entity"}`);
        continue;
      }
      if (acct.Status && acct.Status !== "ACTIVE") {
        add("ARCHIVED_ACCOUNT", `line ${i + 1}: account ${code} (${acct.Name}) is ${acct.Status}, not ACTIVE`);
      }
      if (acct.Type === "BANK" || acct.Class === "BANK") {
        add("BANK_ACCOUNT", `line ${i + 1}: account ${code} (${acct.Name}) is a bank account; Xero rejects manual journals to bank accounts`);
      }
    }
  }

  // ── period ───────────────────────────────────────────────────────────────
  if (isValidIsoDate(body.date)) {
    const lock = [lockDates.periodLockDate, lockDates.endOfYearLockDate]
      .filter((d) => typeof d === "string" && ISO_DATE.test(d.slice(0, 10)))
      .map((d) => d.slice(0, 10))
      .sort()
      .pop();
    if (lock && body.date <= lock) {
      add("PERIOD_LOCKED", `date ${body.date} falls on or before the lock date ${lock}`);
    }
    const today = new Date(now).toISOString().slice(0, 10);
    if (body.date > today) {
      warnings.push(`FUTURE_PERIOD: date ${body.date} is in the future (today is ${today})`);
    }
  }

  // ── approval ─────────────────────────────────────────────────────────────
  const ap = body.approval;
  if (!ap || typeof ap !== "object") {
    add("MISSING_APPROVAL", "approval is required, including on dry_run");
  } else {
    for (const f of ["approved_by", "approved_at", "presented_text", "agreed_text"]) {
      if (!ap[f] || !String(ap[f]).trim()) {
        add("MISSING_APPROVAL", `approval.${f} is required`);
      }
    }
    if (ap.approved_at) {
      const t = Date.parse(ap.approved_at);
      if (Number.isNaN(t)) {
        add("MISSING_APPROVAL", `approval.approved_at is not a timestamp: ${JSON.stringify(ap.approved_at)}`);
      } else {
        const age = now - t;
        if (age > APPROVAL_MAX_AGE_MS) {
          add("APPROVAL_STALE", `approved_at is ${Math.round(age / 60000)} minutes old; an approval older than 30 minutes was given to different numbers`);
        } else if (age < -60_000) {
          add("APPROVAL_STALE", `approved_at is in the future by ${Math.round(-age / 60000)} minutes`);
        }
      }
    }
    if (ap.presented_text) {
      const missing = checkApprovalText(ap.presented_text, { entityNames: names, date: body.date, lines });
      if (missing.length) {
        add("APPROVAL_MISMATCH", `presented_text does not mention: ${missing.join(", ")}. The text shown to the approver must describe the journal being posted.`);
      }
      const unseen = approvalAmountWarnings(ap.presented_text, lines);
      if (unseen.length) {
        warnings.push(`APPROVAL_AMOUNTS: presented_text does not contain ${unseen.join(", ")} - check the approver saw these amounts`);
      }
    }
  }

  // ── materiality ──────────────────────────────────────────────────────────
  // A rule, not a threshold. At £1 this fires on effectively every journal, and
  // that is the intent: uniform context is what makes an unusual number stand
  // out. Never blocks.
  if (moneyClean && lines.length) {
    const largest = Math.max(...lines.map((l) => Math.abs(toPence(l.amount) ?? 0)));
    const threshold = Math.round(Number(materialityGbp) * 100);
    if (largest >= threshold) {
      warnings.push(`MATERIALITY: ${fromPence(largest)} meets or exceeds the ${fromPence(threshold)} journal materiality threshold`);
    }
  }

  return { issues, warnings, net, balanced: moneyClean && net === 0 };
}

/**
 * A stable hash of the parts of a request that define the journal.
 *
 * Used to tell a genuine retry from a caller reusing a key for different
 * numbers. Deliberately excludes approval and dry_run: re-approving the same
 * journal, or dry-running it first, does not make it a different journal.
 * Amounts are normalised to pence so 50000 and "50000.00" hash alike.
 */
function requestFingerprint(body) {
  const canonical = {
    date: body.date ?? null,
    narration: String(body.narration ?? "").trim(),
    status: body.status ?? "DRAFT",
    reference: body.reference ?? null,
    lines: (Array.isArray(body.lines) ? body.lines : [])
      .map((l) => ({
        code: String(l.account_code ?? ""),
        pence: toPence(l.amount),
        description: String(l.description ?? "").trim(),
        tax: l.tax_type ?? "NONE",
      }))
      .sort((a, b) =>
        a.code === b.code
          ? (a.pence ?? 0) - (b.pence ?? 0)
          : a.code < b.code ? -1 : 1
      ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

/** Builds the Xero ManualJournals payload. Positive = debit, as the plugin. */
function buildXeroPayload(body) {
  return {
    Narration: String(body.narration).trim(),
    Date: body.date,
    Status: body.status ?? "DRAFT",
    JournalLines: (body.lines || []).map((l) => ({
      LineAmount: Number(fromPence(toPence(l.amount))),
      AccountCode: String(l.account_code),
      Description: String(l.description ?? ""),
      TaxType: l.tax_type ?? "NONE",
    })),
  };
}

/**
 * Pulls per-account balances out of a Xero TrialBalance report.
 *
 * The report nests Sections containing Rows whose first cell carries the
 * account id in its Attributes. Returns a map keyed by account id; the caller
 * maps those to codes using the chart of accounts it already holds.
 */
function trialBalanceByAccountId(report) {
  const out = {};
  const num = (v) => {
    const n = Number(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  for (const section of report?.Rows ?? []) {
    for (const row of section?.Rows ?? []) {
      if (row?.RowType !== "Row") continue;
      const cells = row.Cells ?? [];
      const id = cells[0]?.Attributes?.find((a) => a.Id === "account")?.Value;
      if (!id) continue;
      out[id] = {
        name: cells[0]?.Value ?? null,
        debit: num(cells[1]?.Value),
        credit: num(cells[2]?.Value),
        ytdDebit: num(cells[3]?.Value),
        ytdCredit: num(cells[4]?.Value),
      };
    }
  }
  return out;
}

/** Reduces those to the codes this journal touches, for the audit record. */
function balancesForCodes(byAccountId, accounts, codes) {
  const idByCode = new Map(accounts.map((a) => [String(a.Code), a.AccountID]));
  const out = {};
  for (const code of new Set(codes.map(String))) {
    const id = idByCode.get(code);
    const b = id ? byAccountId[id] : null;
    out[code] = b ? { debit: b.debit, credit: b.credit, ytdDebit: b.ytdDebit, ytdCredit: b.ytdCredit } : null;
  }
  return out;
}

module.exports = {
  toPence,
  fromPence,
  isValidIsoDate,
  checkApprovalText,
  validateJournal,
  requestFingerprint,
  buildXeroPayload,
  trialBalanceByAccountId,
  balancesForCodes,
  APPROVAL_MAX_AGE_MS,
};

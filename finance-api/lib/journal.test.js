import { describe, expect, it } from "vitest";
import {
  balancesForCodes,
  buildXeroPayload,
  fromPence,
  isValidIsoDate,
  requestFingerprint,
  toPence,
  trialBalanceByAccountId,
  validateJournal,
} from "./journal.js";

// A chart of accounts shaped like FGH's, including the archived code the spec
// names and a bank account.
const ACCOUNTS = [
  { Code: "400", Name: "Advertising & Marketing", Type: "EXPENSE", Status: "ACTIVE", AccountID: "id-400" },
  { Code: "805", Name: "Accruals", Type: "CURRLIAB", Status: "ACTIVE", AccountID: "id-805" },
  { Code: "803", Name: "Old Payable", Type: "CURRLIAB", Status: "ARCHIVED", AccountID: "id-803" },
  { Code: "090", Name: "Business Bank Account", Type: "BANK", Status: "ACTIVE", AccountID: "id-090" },
];

const NOW = Date.parse("2026-08-14T15:04:05Z");

function journal(over = {}) {
  return {
    date: "2026-08-31",
    narration: "Provision for marketing costs - August 2026",
    status: "DRAFT",
    lines: [
      { account_code: "400", amount: 50000.0, description: "Marketing provision", tax_type: "NONE" },
      { account_code: "805", amount: -50000.0, description: "Provision", tax_type: "NONE" },
    ],
    approval: {
      approved_by: "nik@stza.io",
      approved_at: "2026-08-14T15:03:58Z",
      via: "cowork",
      presented_text:
        "Post to Feldspar Group Holdings, 2026-08-31:\n Dr 400 Marketing 50000.00\n Cr 805 Provision 50000.00",
      agreed_text: "approved",
    },
    ...over,
  };
}

const OPTS = {
  accounts: ACCOUNTS,
  lockDates: {},
  now: NOW,
  entityNames: ["feldspar-group-holdings", "FGH", "Feldspar Group Holdings Limited"],
  materialityGbp: 1,
};

const codes = (r) => r.issues.map((i) => i.code);

describe("toPence", () => {
  it("parses numbers and strings identically", () => {
    expect(toPence(50000)).toBe(5_000_000);
    expect(toPence("50000")).toBe(5_000_000);
    expect(toPence("50000.00")).toBe(5_000_000);
    expect(toPence(-1234.56)).toBe(-123_456);
    expect(toPence("0.01")).toBe(1);
  });

  // The reason this exists. 0.1 + 0.2 is not 0.3 in float, so a journal summed
  // in pounds can be "unbalanced" by a rounding artefact, or balanced when it
  // is not.
  it("makes float addition irrelevant", () => {
    expect(toPence(0.1) + toPence(0.2)).toBe(30);
    expect(toPence(0.1) + toPence(0.2) - toPence(0.3)).toBe(0);
    expect(0.1 + 0.2 === 0.3).toBe(false);
  });

  it("rejects more than two decimals rather than rounding", () => {
    expect(toPence("1.005")).toBeNull();
    expect(toPence(1.005)).toBeNull();
  });

  it("rejects anything that is not a money value", () => {
    for (const v of [null, undefined, "", "abc", "1,000.00", "£50", NaN, Infinity, "1e5", {}]) {
      expect(toPence(v)).toBeNull();
    }
  });

  it("round-trips through fromPence", () => {
    for (const v of ["0.00", "0.01", "-0.01", "50000.00", "-1234.56"]) {
      expect(fromPence(toPence(v))).toBe(v);
    }
  });
});

describe("isValidIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isValidIsoDate("2026-08-31")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false); // not a real day
    expect(isValidIsoDate("2026-8-31")).toBe(false);
    expect(isValidIsoDate("31/08/2026")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("validateJournal", () => {
  it("passes a well-formed journal", () => {
    const r = validateJournal(journal(), OPTS);
    expect(r.issues).toEqual([]);
    expect(r.balanced).toBe(true);
    expect(r.net).toBe(0);
  });

  it("rejects an unbalanced journal and says by how much", () => {
    const r = validateJournal(
      journal({
        lines: [
          { account_code: "400", amount: 50000.0 },
          { account_code: "805", amount: -49000.0 },
        ],
      }),
      OPTS
    );
    expect(codes(r)).toContain("UNBALANCED");
    expect(r.issues.find((i) => i.code === "UNBALANCED").detail).toContain("1000.00");
  });

  // Every failure at once. A human approving a journal should not discover the
  // problems one resubmission at a time.
  it("returns all failures together, not just the first", () => {
    const r = validateJournal(
      journal({
        date: "31-08-2026",
        narration: "",
        lines: [{ account_code: "999", amount: 0 }],
        approval: undefined,
      }),
      OPTS
    );
    expect(codes(r)).toEqual(expect.arrayContaining([
      "NO_NARRATION", "DATE_FORMAT", "NO_LINES", "ZERO_AMOUNT", "UNKNOWN_ACCOUNT", "MISSING_APPROVAL",
    ]));
  });

  it("rejects unknown, archived and bank accounts", () => {
    const unknown = validateJournal(journal({ lines: [
      { account_code: "999", amount: 100 }, { account_code: "805", amount: -100 },
    ] }), OPTS);
    expect(codes(unknown)).toContain("UNKNOWN_ACCOUNT");

    const archived = validateJournal(journal({ lines: [
      { account_code: "803", amount: 100 }, { account_code: "805", amount: -100 },
    ] }), OPTS);
    expect(codes(archived)).toContain("ARCHIVED_ACCOUNT");

    const bank = validateJournal(journal({ lines: [
      { account_code: "090", amount: 100 }, { account_code: "805", amount: -100 },
    ] }), OPTS);
    expect(codes(bank)).toContain("BANK_ACCOUNT");
  });

  it("rejects a date on or before the lock date, using the later of the two locks", () => {
    const opts = { ...OPTS, lockDates: { periodLockDate: "2026-06-30T00:00:00", endOfYearLockDate: "2026-09-30T00:00:00" } };
    expect(codes(validateJournal(journal({ date: "2026-08-31" }), opts))).toContain("PERIOD_LOCKED");
    expect(codes(validateJournal(journal({ date: "2026-10-31" }), opts))).not.toContain("PERIOD_LOCKED");
  });

  it("warns about a future period without blocking", () => {
    const r = validateJournal(journal({ date: "2027-01-31" }), OPTS);
    expect(codes(r)).not.toContain("FUTURE_PERIOD");
    expect(r.warnings.join(" ")).toContain("FUTURE_PERIOD");
  });

  describe("approval", () => {
    it("is required, and required on dry_run too", () => {
      expect(codes(validateJournal(journal({ approval: undefined, dry_run: true }), OPTS))).toContain("MISSING_APPROVAL");
    });

    it("requires the evidential fields, not just a name", () => {
      const r = validateJournal(journal({ approval: { approved_by: "nik@stza.io" } }), OPTS);
      const detail = r.issues.filter((i) => i.code === "MISSING_APPROVAL").map((i) => i.detail).join(" ");
      expect(detail).toContain("approved_at");
      expect(detail).toContain("presented_text");
      expect(detail).toContain("agreed_text");
    });

    it("rejects an approval older than 30 minutes", () => {
      const stale = new Date(NOW - 45 * 60 * 1000).toISOString();
      const r = validateJournal(journal({ approval: { ...journal().approval, approved_at: stale } }), OPTS);
      expect(codes(r)).toContain("APPROVAL_STALE");
    });

    it("rejects an approval timestamped in the future", () => {
      const ahead = new Date(NOW + 30 * 60 * 1000).toISOString();
      const r = validateJournal(journal({ approval: { ...journal().approval, approved_at: ahead } }), OPTS);
      expect(codes(r)).toContain("APPROVAL_STALE");
    });

    // The one drift the assertion model can catch by itself: text shown to the
    // human that does not describe the journal being posted.
    it("rejects presented_text that omits an account being posted to", () => {
      const r = validateJournal(
        journal({
          lines: [
            { account_code: "400", amount: 50000 },
            { account_code: "803", amount: -50000 },
          ],
          approval: { ...journal().approval, presented_text: "Post to Feldspar Group Holdings, 2026-08-31: Dr 400 50000.00" },
        }),
        { ...OPTS, accounts: [...ACCOUNTS, { Code: "803", Name: "x", Type: "CURRLIAB", Status: "ACTIVE", AccountID: "id-803b" }] }
      );
      expect(codes(r)).toContain("APPROVAL_MISMATCH");
      expect(r.issues.find((i) => i.code === "APPROVAL_MISMATCH").detail).toContain("803");
    });

    it("rejects presented_text for the wrong entity", () => {
      const r = validateJournal(
        journal({ approval: { ...journal().approval, presented_text: "Post to Ultraspeed Digital Limited, 2026-08-31: 400 805" } }),
        OPTS
      );
      expect(codes(r)).toContain("APPROVAL_MISMATCH");
    });

    it("accepts presented_text naming the entity by slug", () => {
      const r = validateJournal(
        journal({ approval: { ...journal().approval, presented_text: "feldspar-group-holdings 2026-08-31 400 805 50000.00" } }),
        OPTS
      );
      expect(codes(r)).not.toContain("APPROVAL_MISMATCH");
    });

    // Formatting differences must not block a genuinely approved journal.
    it("warns rather than blocks when amounts are formatted differently", () => {
      const r = validateJournal(
        journal({ approval: { ...journal().approval, presented_text: "Feldspar Group Holdings 2026-08-31 Dr 400 £50,000 Cr 805 £50,000" } }),
        OPTS
      );
      expect(codes(r)).not.toContain("APPROVAL_MISMATCH");
      expect(r.issues).toEqual([]);
    });
  });

  it("warns on materiality at £1 without ever blocking", () => {
    const r = validateJournal(journal({ lines: [
      { account_code: "400", amount: 1.0 }, { account_code: "805", amount: -1.0 },
    ] }), OPTS);
    expect(r.issues).toEqual([]);
    expect(r.warnings.join(" ")).toContain("MATERIALITY");
  });
});

describe("requestFingerprint", () => {
  it("is stable across equivalent formatting and line order", () => {
    const a = requestFingerprint(journal());
    const b = requestFingerprint(journal({
      lines: [
        { account_code: "805", amount: "-50000.00", description: "Provision", tax_type: "NONE" },
        { account_code: "400", amount: "50000", description: "Marketing provision", tax_type: "NONE" },
      ],
    }));
    expect(a).toBe(b);
  });

  // Re-approving the same journal does not make it a different journal.
  it("ignores approval and dry_run", () => {
    expect(requestFingerprint(journal())).toBe(
      requestFingerprint(journal({ dry_run: true, approval: { approved_by: "someone@else.com", approved_at: "x", presented_text: "y", agreed_text: "z" } }))
    );
  });

  it("changes when the numbers change", () => {
    expect(requestFingerprint(journal())).not.toBe(
      requestFingerprint(journal({ lines: [
        { account_code: "400", amount: 50000.01, description: "Marketing provision", tax_type: "NONE" },
        { account_code: "805", amount: -50000.01, description: "Provision", tax_type: "NONE" },
      ] }))
    );
  });

  it("changes when the account changes", () => {
    expect(requestFingerprint(journal())).not.toBe(
      requestFingerprint(journal({ lines: [
        { account_code: "401", amount: 50000, description: "Marketing provision", tax_type: "NONE" },
        { account_code: "805", amount: -50000, description: "Provision", tax_type: "NONE" },
      ] }))
    );
  });
});

describe("buildXeroPayload", () => {
  it("keeps the plugin's sign convention and defaults status to DRAFT", () => {
    const p = buildXeroPayload(journal({ status: undefined }));
    expect(p.Status).toBe("DRAFT");
    expect(p.JournalLines[0]).toEqual({
      LineAmount: 50000, AccountCode: "400", Description: "Marketing provision", TaxType: "NONE",
    });
    expect(p.JournalLines[1].LineAmount).toBe(-50000);
  });
});

describe("trialBalanceByAccountId", () => {
  const report = {
    Rows: [
      { RowType: "Header", Cells: [{ Value: "Account" }] },
      {
        RowType: "Section",
        Rows: [
          {
            RowType: "Row",
            Cells: [
              { Value: "Advertising & Marketing (400)", Attributes: [{ Id: "account", Value: "id-400" }] },
              { Value: "12,000.00" }, { Value: "" }, { Value: "12,000.00" }, { Value: "" },
            ],
          },
          { RowType: "SummaryRow", Cells: [{ Value: "Total" }, { Value: "12,000.00" }] },
        ],
      },
    ],
  };

  it("extracts balances keyed by account id, stripping thousands separators", () => {
    const out = trialBalanceByAccountId(report);
    expect(out["id-400"]).toEqual({
      name: "Advertising & Marketing (400)", debit: 12000, credit: 0, ytdDebit: 12000, ytdCredit: 0,
    });
    expect(Object.keys(out)).toHaveLength(1); // SummaryRow has no account id
  });

  it("maps to the codes a journal touches, and reports unknown ones as null", () => {
    const out = balancesForCodes(trialBalanceByAccountId(report), ACCOUNTS, ["400", "805"]);
    expect(out["400"].debit).toBe(12000);
    expect(out["805"]).toBeNull();
  });

  it("survives a malformed report rather than throwing", () => {
    expect(trialBalanceByAccountId(null)).toEqual({});
    expect(trialBalanceByAccountId({})).toEqual({});
    expect(trialBalanceByAccountId({ Rows: [{}] })).toEqual({});
  });
});

// Regression: the entity's stored name is a short code ("FGH"), while approval
// text written for a human says "Feldspar Group Holdings". Requiring the slug
// or the stored name alone rejected a genuine journal on the first live dry
// run. Any known name for the entity must satisfy the check.
describe("APPROVAL_MISMATCH entity naming", () => {
  const names = ["feldspar-group-holdings", "FGH", "Feldspar Group Holdings Limited"];
  const opts = { accounts: ACCOUNTS, lockDates: {}, now: NOW, entityNames: names, materialityGbp: 1 };

  for (const form of ["FGH", "feldspar-group-holdings", "Feldspar Group Holdings Limited"]) {
    it(`accepts presented_text naming the entity as "${form}"`, () => {
      const r = validateJournal(
        journal({ approval: { ...journal().approval, presented_text: `Post to ${form}, 2026-08-31: Dr 400 Cr 805 50000.00` } }),
        opts
      );
      expect(r.issues.map((i) => i.code)).not.toContain("APPROVAL_MISMATCH");
    });
  }

  it("still rejects text naming a different company", () => {
    const r = validateJournal(
      journal({ approval: { ...journal().approval, presented_text: "Post to Ultraspeed Digital Limited, 2026-08-31: Dr 400 Cr 805" } }),
      opts
    );
    expect(r.issues.map((i) => i.code)).toContain("APPROVAL_MISMATCH");
  });
});

import { describe, expect, it } from "vitest";
import {
  ageInvoices,
  bucketFor,
  fetchAllInvoices,
  legacyShape,
  normaliseName,
  outstandingWhere,
  summarise,
} from "./ageing.js";

// A group shaped like Feldspar's: short codes in name, legal names alongside.
const GROUP = [
  { slug: "feldspar-group-holdings", name: "FGH", legal_name: "Feldspar Group Holdings Limited" },
  { slug: "feldspar-ltd", name: "FSL", legal_name: "Feldspar Ltd" },
  { slug: "ultraspeed-digital", name: "UDL", legal_name: "Ultraspeed Digital Limited" },
];
const FGH = { slug: "feldspar-group-holdings", name: "FGH" };
const AS_AT = "2026-09-11";

function bill(over = {}) {
  return {
    InvoiceID: "inv-1",
    InvoiceNumber: "B-1",
    Contact: { Name: "Acme Supplies Ltd" },
    DateString: "2026-08-01T00:00:00",
    DueDateString: "2026-09-11T00:00:00",
    CurrencyCode: "GBP",
    AmountDue: 100,
    Status: "AUTHORISED",
    ...over,
  };
}

describe("bucketFor", () => {
  it("puts not-yet-due and due-today in current", () => {
    expect(bucketFor(-5)).toBe("current");
    expect(bucketFor(0)).toBe("current");
  });
  it("uses inclusive upper bounds of 30/60/90", () => {
    expect(bucketFor(1)).toBe("1-30");
    expect(bucketFor(30)).toBe("1-30");
    expect(bucketFor(31)).toBe("31-60");
    expect(bucketFor(60)).toBe("31-60");
    expect(bucketFor(61)).toBe("61-90");
    expect(bucketFor(90)).toBe("61-90");
    expect(bucketFor(91)).toBe("90+");
  });
});

describe("ageInvoices", () => {
  it("ages by due date against the as-at date", () => {
    const [r] = ageInvoices([bill({ DueDateString: "2026-08-11T00:00:00" })], {
      asAt: AS_AT, entity: FGH, groupEntities: GROUP,
    });
    expect(r.daysOverdue).toBe(31);
    expect(r.bucket).toBe("31-60");
    expect(r.dueDate).toBe("2026-08-11");
    expect(r.entity).toBe("feldspar-group-holdings");
  });

  it("reads the /Date()/ form when DueDateString is missing", () => {
    const [r] = ageInvoices(
      [bill({ DueDateString: undefined, DueDate: `/Date(${Date.UTC(2026, 5, 1)}+0000)/` })],
      { asAt: AS_AT, entity: FGH, groupEntities: GROUP }
    );
    expect(r.dueDate).toBe("2026-06-01");
    expect(r.bucket).toBe("90+");
  });

  it("drops anything that is not AUTHORISED", () => {
    const rows = ageInvoices(
      [bill(), bill({ Status: "SUBMITTED" }), bill({ Status: "DRAFT" })],
      { asAt: AS_AT, entity: FGH, groupEntities: GROUP }
    );
    expect(rows).toHaveLength(1);
  });

  it("flags a supplier that is another group entity, by name or legal name", () => {
    const rows = ageInvoices(
      [
        bill({ Contact: { Name: "Ultraspeed Digital Ltd." } }),
        bill({ Contact: { Name: "FSL" } }),
        bill({ Contact: { Name: "Feldspar Sports Media Ltd" } }),
      ],
      { asAt: AS_AT, entity: FGH, groupEntities: GROUP }
    );
    expect(rows.map((r) => r.intercompany)).toEqual([true, true, false]);
  });
});

describe("normaliseName", () => {
  it("ignores case, punctuation and company suffixes", () => {
    expect(normaliseName("Feldspar Group Holdings LIMITED")).toBe("feldspar group holdings");
    expect(normaliseName("Acme, Ltd.")).toBe("acme");
    expect(normaliseName("Big Co PLC")).toBe("big co");
  });
});

describe("summarise", () => {
  const rows = ageInvoices(
    [
      bill({ AmountDue: 0.1 }),
      bill({ AmountDue: 0.2, InvoiceNumber: "B-2" }),
      bill({ AmountDue: 50, DueDateString: "2026-07-01T00:00:00", InvoiceNumber: "B-3" }),
      bill({ AmountDue: 7, CurrencyCode: "USD", Contact: { Name: "GitHub" } }),
      bill({ AmountDue: 1000, Contact: { Name: "Ultraspeed Digital Limited" } }),
    ],
    { asAt: AS_AT, entity: FGH, groupEntities: GROUP }
  );
  const s = summarise(rows);

  it("never adds currencies together", () => {
    expect(Object.keys(s.currencies).sort()).toEqual(["GBP", "USD"]);
    expect(s.currencies.USD.buckets.total).toBe(7);
    expect(s.currencies.GBP.buckets.total).toBe(1050.3);
  });

  it("sums in pence so 0.1 + 0.2 foots", () => {
    expect(s.currencies.GBP.buckets.current).toBe(1000.3);
  });

  it("reports the intercompany share separately", () => {
    expect(s.currencies.GBP.intercompany.total).toBe(1000);
    expect(s.currencies.GBP.intercompany.current).toBe(1000);
  });

  it("groups suppliers by entity, contact and currency, largest first", () => {
    expect(s.suppliers[0].contact).toBe("Ultraspeed Digital Limited");
    expect(s.suppliers[0].intercompany).toBe(true);
    const acme = s.suppliers.find((x) => x.contact === "Acme Supplies Ltd");
    expect(acme.invoiceCount).toBe(3);
    expect(acme.total).toBe(50.3);
    expect(acme.buckets["61-90"]).toBe(50);
  });
});

describe("legacyShape", () => {
  it("keeps the old bucket keys the runner reads", () => {
    const rows = ageInvoices(
      [bill({ DueDateString: "2026-08-20T00:00:00" }), bill({ DueDateString: "2026-05-01T00:00:00" })],
      { asAt: AS_AT, entity: FGH, groupEntities: GROUP }
    );
    const l = legacyShape(rows);
    // Sorted: JS lists integer-like keys ("30") first whatever the insertion order.
    expect(Object.keys(l.buckets).sort()).toEqual(["30", "60", "90", "90+", "current", "total"]);
    expect(l.buckets["30"]).toBe(100);
    expect(l.buckets["90+"]).toBe(100);
    expect(l.invoices.map((i) => i.bucket)).toEqual(["30", "90+"]);
    expect(l.invoiceCount).toBe(2);
  });
});

describe("fetchAllInvoices", () => {
  const page = (n) => Array.from({ length: n }, (_, i) => bill({ InvoiceID: `i${i}` }));

  it("keeps reading until a short page", async () => {
    const sizes = [100, 100, 3];
    const r = await fetchAllInvoices(async (p) => page(sizes[p - 1]));
    expect(r.invoices).toHaveLength(203);
    expect(r.pages).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it("stops at the cap and says so", async () => {
    const r = await fetchAllInvoices(async () => page(100), { maxPages: 2 });
    expect(r.invoices).toHaveLength(200);
    expect(r.truncated).toBe(true);
  });
});

describe("outstandingWhere", () => {
  it("filters to authorised invoices with something still due", () => {
    expect(outstandingWhere("ACCPAY")).toBe('Type=="ACCPAY" AND Status=="AUTHORISED" AND AmountDue>0');
  });
});

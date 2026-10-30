import { describe, it, expect } from "vitest";
import { agentFor, askedText, clientSlugOf, pageContext, withPageContext } from "./page-context";

describe("page context", () => {
  it("finds the client from either kind of client page", () => {
    expect(clientSlugOf("/finance/clients/jo-bloggs-ltd/bills")).toBe("jo-bloggs-ltd");
    expect(clientSlugOf("/clients/all/jo-bloggs-ltd")).toBe("jo-bloggs-ltd");
    expect(clientSlugOf("/clients/pipeline")).toBeNull();
    expect(clientSlugOf("/registry")).toBeNull();
  });

  it("reads the company and item being looked at", () => {
    const c = pageContext("/finance/clients/jo-bloggs-ltd/bills", new URLSearchParams("entity=jo-trading&item=abc"));
    expect(c).toMatchObject({ slug: "jo-bloggs-ltd", section: "Bills", entity: "jo-trading", item: "abc" });
    expect(agentFor(c!.section)).toBe("ap-clerk");
    expect(agentFor("Work")).toBe("");
  });

  it("sends the page with the question and shows only the question back", () => {
    const c = pageContext("/finance/clients/jo-bloggs-ltd/bills", new URLSearchParams("entity=jo-trading&item=abc"))!;
    const sent = withPageContext("  Who is this supplier? ", c, "Supplier: Acme");
    expect(sent).toContain("Bills item: abc");
    expect(sent).toContain("On screen:\nSupplier: Acme");
    expect(askedText(sent)).toBe("Who is this supplier?");
    expect(askedText("An older question")).toBe("An older question");
  });

  it("caps what is taken from the screen", () => {
    const c = pageContext("/clients/all/jo-bloggs-ltd", new URLSearchParams())!;
    expect(withPageContext("q", c, "x".repeat(10000)).length).toBeLessThan(3300);
  });
});

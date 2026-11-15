import { describe, it, expect } from "vitest";
import { checkWebsite, classify, isBlockedAddress, guardedLookup, fetchOnce } from "./website-check";

describe("addresses we never connect to", () => {
  it("refuses the metadata server, private, loopback and mapped addresses", () => {
    for (const a of ["169.254.169.254", "10.1.2.3", "172.20.0.1", "192.168.1.1", "127.0.0.1", "100.100.1.1", "0.0.0.0",
      "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:169.254.169.254"]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const a of ["8.8.8.8", "41.203.1.1", "172.32.0.1", "2a00:1450:4009::200e"]) expect(isBlockedAddress(a), a).toBe(false);
  });

  it("refuses the metadata host name before resolving it", async () => {
    const err = await new Promise((r) => guardedLookup("metadata.google.internal", {}, (e) => r(e)));
    expect(err.code).toBe("EBLOCKED");
  });

  it("refuses private IPs and odd ports in the address itself", async () => {
    await expect(fetchOnce("http://169.254.169.254/computeMetadata/v1/")).rejects.toMatchObject({ code: "EBLOCKED" });
    await expect(fetchOnce("http://example.com:8080/")).rejects.toMatchObject({ code: "EBLOCKED" });
    await expect(fetchOnce("file:///etc/passwd")).rejects.toMatchObject({ code: "EPROTO" });
  });
});

describe("what a check found", () => {
  const page = (title, body = "") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

  it("reads a live site and whether it mentions the organisation", () => {
    const r = classify({ url: "https://acme.co.za", finalUrl: "https://www.acme.co.za/", status: 200, body: page("Acme Sports | Home"), name: "Acme Sports" });
    expect(r).toMatchObject({ outcome: "live", website_status: "live", title: "Acme Sports | Home", mentions_name: true });
  });

  it("spots a parked or for-sale domain", () => {
    const r = classify({ url: "https://acme.co.za", finalUrl: "https://acme.co.za", status: 200, body: page("acme.co.za", "This domain is for sale! Buy this domain"), name: "Acme" });
    expect(r.website_status).toBe("domain_for_sale");
  });

  it("calls a move to another domain a redirect", () => {
    expect(classify({ url: "https://acme.co.za", finalUrl: "https://newbrand.com/", status: 200, body: page("New Brand"), name: "Acme" }).website_status).toBe("redirect");
  });

  it("turns failures into findings", () => {
    expect(classify({ url: "https://x.test", error: Object.assign(new Error("nope"), { code: "ENOTFOUND" }) }).website_status).toBe("dns_error");
    expect(classify({ url: "https://x.test", error: Object.assign(new Error("slow"), { code: "ETIMEDOUT" }) }).website_status).toBe("timeout");
    expect(classify({ url: "https://x.test", error: Object.assign(new Error("refused"), { code: "EBLOCKED" }) }).outcome).toBe("refused");
  });
});

describe("following redirects", () => {
  it("follows a redirect and reports where it ended", async () => {
    const hops = {
      "https://old.test/": { status: 301, location: "https://www.old.test/home" },
      "https://www.old.test/home": { status: 200, body: "<title>Old Co</title>" },
    };
    const r = await checkWebsite("https://old.test/", { name: "Oldtown Rugby", fetchImpl: async (u) => hops[u] });
    expect(r).toMatchObject({ outcome: "live", final_url: "https://www.old.test/home", mentions_name: false });
  });

  it("stops after following four redirects (five requests)", async () => {
    let n = 0;
    const r = await checkWebsite("https://loop.test/", { fetchImpl: async () => ({ status: 302, location: `https://loop.test/${++n}` }) });
    expect(n).toBe(5);
    expect(r.http_status).toBe(302);
  });

  it("records no website without trying", async () => {
    expect((await checkWebsite(null)).outcome).toBe("no_website");
  });
});

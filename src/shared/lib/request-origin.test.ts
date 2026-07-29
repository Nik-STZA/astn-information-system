import { describe, expect, it } from "vitest";
import { clientIpFrom, isIpAddress, publicOrigin } from "@/shared/lib/request-origin";

describe("clientIpFrom", () => {
  // The exact value that broke a live Xero connection: the load balancer sends
  // a chain, and Postgres inet takes one address.
  it("takes only the client from a forwarded chain", () => {
    expect(clientIpFrom("5.69.166.27,136.68.115.112,2600:1900:0:4301::1b00")).toBe("5.69.166.27");
  });

  it("handles a chain with spaces", () => {
    expect(clientIpFrom("203.0.113.9, 70.41.3.18, 150.172.238.178")).toBe("203.0.113.9");
  });

  it("passes a single address through", () => {
    expect(clientIpFrom("203.0.113.9")).toBe("203.0.113.9");
    expect(clientIpFrom("2600:1900:0:4301::1b00")).toBe("2600:1900:0:4301::1b00");
  });

  it("returns null rather than something Postgres will reject", () => {
    expect(clientIpFrom(null)).toBeNull();
    expect(clientIpFrom(undefined)).toBeNull();
    expect(clientIpFrom("")).toBeNull();
    expect(clientIpFrom("unknown")).toBeNull();
    expect(clientIpFrom("999.1.1.1")).toBeNull();
    expect(clientIpFrom("not an ip, 203.0.113.9")).toBeNull();
  });

  it("strips a port", () => {
    expect(clientIpFrom("203.0.113.9:41234")).toBe("203.0.113.9");
    expect(clientIpFrom("[2600:1900:0:4301::1b00]:443")).toBe("2600:1900:0:4301::1b00");
  });
});

describe("isIpAddress", () => {
  it("accepts valid addresses", () => {
    expect(isIpAddress("127.0.0.1")).toBe(true);
    expect(isIpAddress("255.255.255.255")).toBe(true);
    expect(isIpAddress("::1")).toBe(true);
  });

  it("rejects octets above 255 and plain text", () => {
    expect(isIpAddress("256.0.0.1")).toBe(false);
    expect(isIpAddress("hello")).toBe(false);
    expect(isIpAddress("")).toBe(false);
  });
});

describe("publicOrigin", () => {
  const headers = (h: Record<string, string>) => ({
    get: (name: string) => h[name.toLowerCase()] ?? null,
  });

  // Inside the container the request host is 0.0.0.0:8080, so a redirect built
  // from it is unreachable. That is what sent a real Xero callback to
  // https://0.0.0.0:8080/...
  it("prefers the forwarded host over the internal one", () => {
    expect(
      publicOrigin(
        headers({ "x-forwarded-host": "os.stza.io", "x-forwarded-proto": "https" }),
        "https://0.0.0.0:8080"
      )
    ).toBe("https://os.stza.io");
  });

  it("assumes https when only a forwarded host is given", () => {
    expect(publicOrigin(headers({ "x-forwarded-host": "os.stza.io" }), "http://0.0.0.0:8080")).toBe(
      "https://os.stza.io"
    );
  });

  it("takes the first entry when the forwarded host is itself a list", () => {
    expect(
      publicOrigin(
        headers({ "x-forwarded-host": "os.stza.io, internal.run.app", "x-forwarded-proto": "https, http" }),
        "https://0.0.0.0:8080"
      )
    ).toBe("https://os.stza.io");
  });

  it("falls back to the host header", () => {
    expect(publicOrigin(headers({ host: "localhost:3000" }), "http://0.0.0.0:8080")).toBe(
      "https://localhost:3000"
    );
  });

  it("falls back to the supplied origin when nothing is forwarded", () => {
    expect(publicOrigin(headers({}), "http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });
});

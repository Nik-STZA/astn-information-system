import { describe, expect, it } from "vitest";
const { xeroLimiter, retryWait } = require("./xero-limit");

const res = (status, retryAfter) => ({ status, headers: { get: () => retryAfter ?? null } });

describe("retryWait", () => {
  it("waits as Xero says", () => {
    expect(retryWait(res(429, "7"), 1)).toBe(7);
  });
  it("backs off when Xero does not say", () => {
    expect(retryWait(res(429), 2)).toBe(4);
  });
  it("gives up on anything but a 429, after three tries, or on a long wait", () => {
    expect(retryWait(res(500), 1)).toBeNull();
    expect(retryWait(res(429), 3)).toBeNull();
    expect(retryWait(res(429, "3600"), 1)).toBeNull();
  });
});

describe("xeroLimiter", () => {
  it("retries a 429 and returns the good answer", async () => {
    const waits = [];
    const limited = xeroLimiter({ sleep: async (s) => { waits.push(s); } });
    const answers = [res(429, "2"), res(200)];
    const r = await limited("org", async () => answers.shift());
    expect(r.status).toBe(200);
    expect(waits).toEqual([2]);
  });
  it("hands back the 429 when retries run out", async () => {
    const limited = xeroLimiter({ sleep: async () => {} });
    let calls = 0;
    const r = await limited("org", async () => { calls += 1; return res(429); });
    expect(r.status).toBe(429);
    expect(calls).toBe(3);
  });
  it("holds calls above the limit for one organisation, not another", async () => {
    const limited = xeroLimiter({ maxAtOnce: 2 });
    let now = 0;
    let most = 0;
    const call = async () => {
      now += 1; most = Math.max(most, now);
      await new Promise((done) => setTimeout(done, 5));
      now -= 1;
      return res(200);
    };
    await Promise.all(Array.from({ length: 6 }, () => limited("org", call)));
    expect(most).toBe(2);
    most = 0;
    await Promise.all([limited("a", call), limited("b", call), limited("c", call)]);
    expect(most).toBe(3);
  });
  it("frees the slot when a call throws", async () => {
    const limited = xeroLimiter({ maxAtOnce: 1 });
    await expect(limited("org", async () => { throw new Error("down"); })).rejects.toThrow("down");
    expect((await limited("org", async () => res(200))).status).toBe(200);
  });
});

import { describe, expect, it } from "vitest";
import { versionsToDestroy } from "./secret-versions";

const v = (n, state = "ENABLED") => ({ name: `projects/1/secrets/xero-refresh-x/versions/${n}`, state });

describe("versionsToDestroy", () => {
  it("keeps the newest two and destroys the rest, oldest first", () => {
    expect(versionsToDestroy([v(1), v(3), v(2), v(4)])).toEqual([v(1).name, v(2).name]);
  });

  it("orders by version number, not as text", () => {
    expect(versionsToDestroy([v(9), v(10), v(11)])).toEqual([v(9).name]);
  });

  it("counts disabled versions, because Google bills them too", () => {
    expect(versionsToDestroy([v(1, "DISABLED"), v(2), v(3)])).toEqual([v(1).name]);
  });

  it("ignores versions already destroyed", () => {
    expect(versionsToDestroy([v(1, "DESTROYED"), v(2), v(3)])).toEqual([]);
  });

  it("does nothing when there are two or fewer", () => {
    expect(versionsToDestroy([v(1)])).toEqual([]);
    expect(versionsToDestroy([])).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// getIapEmail returns a Promise. Without await it is always truthy, so a check
// like `if (!getIapEmail())` would pass for everyone, with no error anywhere.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

describe("the login check", () => {
  it("is awaited everywhere it is called", () => {
    const missing = sources("src").flatMap((path) =>
      readFileSync(path, "utf-8")
        .split("\n")
        .filter((line) =>
          /\bgetIapEmail\(\)/.test(line)
          && !/await getIapEmail\(\)/.test(line)
          && !/function getIapEmail/.test(line)
          && !/^\s*(\/\/|\*)/.test(line))
        .map((line) => `${path}: ${line.trim()}`));
    expect(missing).toEqual([]);
  });
});

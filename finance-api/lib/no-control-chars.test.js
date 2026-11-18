import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A script that writes source through a shell can turn a regex's "\b" into a
// backspace character (0x08): the code still parses, the word boundary is gone,
// and nothing fails. It happened twice in lib/recs.js (Nov 2026). (NUL is used
// on purpose as a key separator in a few files, so only backspace is checked.)
describe("source files", () => {
  it("hold no backspace characters", () => {
    const dirs = [__dirname, join(__dirname, "..")];
    const bad = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => /\.(js|mjs)$/.test(n))) {
        const s = readFileSync(join(dir, f), "utf8");
        // eslint-disable-next-line no-control-regex
        const m = s.match(/\x08/);
        if (m) bad.push(`${f}: char ${m[0].charCodeAt(0)} at ${m.index}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

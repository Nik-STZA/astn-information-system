// Local file watcher for a client's markdown artefacts.
//
// Runs on the operator machine for v1, per spec section 3.1. It watches the
// client folder, re-parses whatever changed using the module's own parsers,
// and posts the result to stza-finance-api, which owns the write semantics.
//
// It posts only the file that changed, so editing one diary month does not
// touch the others.
//
// Uses fs.watch rather than chokidar to avoid a dependency for something the
// standard library already does. Writes are debounced because editors commonly
// emit several events for one save.
//
// Usage:
//   node scripts/watch-client-files.mjs [--client <slug>] [--folder <path>] [--once]

import { watch, existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parseDiary } from "../src/modules/finance/lib/parse-diary.ts";
import { parseOpenItems } from "../src/modules/finance/lib/parse-open-items.ts";

const API_URL = process.env.FINANCE_API_URL || "http://127.0.0.1:8080";
const API_KEY = process.env.FINANCE_API_KEY;
const DEBOUNCE_MS = 400;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const readUtf8 = (p) => readFileSync(p, "utf-8").replace(/^\uFEFF/, "");
const stamp = () => new Date().toISOString().slice(11, 19);

async function push(slug, payload) {
  const res = await fetch(`${API_URL}/api/finance/clients/${encodeURIComponent(slug)}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`sync returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

// Builds the payload for one changed path. Returns null for files we do not
// mirror, so unrelated edits in the folder are ignored rather than erroring.
function payloadFor(folder, relPath) {
  const abs = join(folder, relPath);
  if (!existsSync(abs)) return null;

  if (relPath.startsWith("diary/") && relPath.endsWith(".md")) {
    return { diary: [{ sourceFile: relPath, entries: parseDiary(readUtf8(abs), relPath) }] };
  }
  if (relPath === "open-items.md") {
    return { openItems: parseOpenItems(readUtf8(abs), "open-items.md") };
  }
  return null;
}

async function syncPath(slug, folder, relPath) {
  const payload = payloadFor(folder, relPath);
  if (!payload) return;
  try {
    const r = await push(slug, payload);
    const what = payload.diary
      ? `${r.diaryEntries} diary entries`
      : `${r.openItems} open items${r.removed ? `, ${r.removed} removed` : ""}`;
    console.log(`${stamp()}  synced ${relPath} -> ${what}`);
  } catch (e) {
    console.error(`${stamp()}  FAILED ${relPath}: ${e.message}`);
  }
}

async function main() {
  const slug = arg("--client", "feldspar-sport-group");
  const folder = arg("--folder", "C:\\Users\\yogim\\STZA Group\\Clients\\feldspar-sport-group");
  const once = process.argv.includes("--once");

  if (!API_KEY) throw new Error("FINANCE_API_KEY is not set");
  if (!existsSync(folder)) throw new Error(`folder not found: ${folder}`);

  console.log(`Watching ${folder}`);
  console.log(`Client:   ${slug}`);
  console.log(`API:      ${API_URL}\n`);

  // Initial reconcile so the mirror is correct before any edit arrives.
  const diaryDir = join(folder, "diary");
  if (existsSync(diaryDir)) {
    const { readdirSync } = await import("node:fs");
    for (const f of readdirSync(diaryDir).filter((x) => x.endsWith(".md")).sort()) {
      await syncPath(slug, folder, `diary/${f}`);
    }
  }
  await syncPath(slug, folder, "open-items.md");

  if (once) {
    console.log("\nInitial reconcile complete. Exiting because --once was given.");
    return;
  }

  const pending = new Map();
  const schedule = (relPath) => {
    clearTimeout(pending.get(relPath));
    pending.set(relPath, setTimeout(() => {
      pending.delete(relPath);
      syncPath(slug, folder, relPath);
    }, DEBOUNCE_MS));
  };

  // Recursive watching is supported on Windows and macOS. On Linux it is not,
  // so fall back to watching the two locations we care about.
  try {
    watch(folder, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      schedule(String(filename).split("\\").join("/"));
    });
  } catch {
    watch(folder, (_e, f) => f && schedule(String(f)));
    if (existsSync(diaryDir)) {
      watch(diaryDir, (_e, f) => f && schedule(`diary/${f}`));
    }
  }

  console.log("\nWatching for changes. Press Ctrl+C to stop.");
}

main().catch((e) => {
  console.error("Watcher failed:", e.message);
  process.exit(1);
});

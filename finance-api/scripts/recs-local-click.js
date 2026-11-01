// Clicks through the reconciliation screens in headless Chrome: the real Next
// build, in front of recs-local-check.js's server. Needs that check's local
// Postgres, a finished `next build`, and Chrome. Run from the repo root:
//   node finance-api/scripts/recs-local-click.js

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

const NEXT = 39871; const PROXY = 39872; const DEBUG = 39873;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, FINANCE_API_URL: "http://127.0.0.1:8788", FINANCE_API_KEY: "k", CLOUD_RUN_API_KEY: "x", CLOUD_RUN_API_URL: "http://127.0.0.1:9", DB_USER: process.env.DB_USER || "africastn_app" };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "recs-click-"));
let out = "";
const api = spawn(process.execPath, ["scripts/recs-local-check.js", "serve"], { cwd: "finance-api", env });
api.stdout.on("data", (d) => { out += d; });
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(NEXT)], { env, stdio: "ignore" });
// Stands in for IAP.
const proxy = http.createServer((req, res) => {
  const headers = { ...req.headers, "x-goog-authenticated-user-email": "accounts.google.com:cfo@example.com", host: `127.0.0.1:${PROXY}` };
  const up = http.request({ host: "127.0.0.1", port: NEXT, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(PROXY, "127.0.0.1");
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let failed = 0;
const ok = (name, cond, extra) => { if (!cond) failed += 1; console.log(cond ? "  ok  " : "  FAIL", name, cond ? "" : JSON.stringify(extra ?? "").slice(0, 300)); };
const done = () => { for (const p of [api, next, chrome]) p.kill(); proxy.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still closing */ } process.exit(failed ? 1 : 0); };
setTimeout(() => { console.log("timed out"); failed += 1; done(); }, 120000);

const finance = (method, p, body, headers = {}) => fetch(`http://127.0.0.1:8788/api/finance/clients/sample-group/${p}`, { method, headers: { "X-API-Key": "k", "X-Actor-Email": "cfo@example.com", "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

(async () => {
  while (!/serving (\S+)/.test(out)) await sleep(300);
  const id = /serving (\S+)/.exec(out)[1];
  await sleep(3000);
  // The CFO prepared this one, so only the tick lets them pass the review.
  await finance("POST", `recs/${id}/reopen`, {});
  await finance("POST", `recs/${id}/prepare`, { note: "Prepared by the CFO alone." });

  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find((t) => t.type === "page"); } catch { /* starting */ } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let n = 0; const wait = new Map(); const problems = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); } if (d.method === "Runtime.exceptionThrown") problems.push(d.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++n; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (e) => (await cdp("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  await cdp("Page.enable"); await cdp("Runtime.enable");
  const url = `http://127.0.0.1:${PROXY}/finance/clients/sample-group/reconciliations/${id}`;
  const page = "document.body.innerText";
  const click = (text) => js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  const tick = () => js("(() => { const c = document.querySelector('input[type=checkbox]'); if (!c) return false; c.click(); return c.checked; })()");

  for (const [w, h, mobile] of [[390, 844, true], [320, 640, true], [1280, 800, false]]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    await cdp("Page.navigate", { url });
    await sleep(2500);
    const m = await js("JSON.stringify([innerWidth, document.documentElement.scrollWidth])");
    const [iw, sw] = JSON.parse(m);
    ok(`no sideways scroll at ${w}`, sw <= iw, m);
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp("Page.navigate", { url });
  await sleep(2500);
  ok("at review, the page offers the tick", (await js(page)).includes("only reviewer"));
  await click("Pass to the CFO");
  await sleep(2000);
  ok("without the tick, the screen shows the refusal", /preparer cannot review/.test(await js(page)), (await js(page)).slice(0, 300));
  ok("tick clicked", await tick());
  await sleep(200);
  ok("pass clicked", await click("Pass to the CFO"));
  await sleep(2500);
  let view = await finance("GET", `recs/${id}`);
  ok("with the tick, the review passes", view.rec.status === "with_cfo", view.rec?.status);
  ok("and the flag is recorded", view.rec.sole_reviewer === true);
  ok("the flag shows on the page", /Sole reviewer: one person/.test(await js(page)));
  await cdp("Page.navigate", { url });
  await sleep(2500);
  ok("at sign-off, the page offers the tick", (await js(page)).includes("only reviewer"));
  console.log("  exceptions:", JSON.stringify(problems.slice(0, 4)));
  ok("no exceptions in the page", problems.length === 0, problems);
  done();
})().catch((e) => { console.error(e); failed += 1; done(); });

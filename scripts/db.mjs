// Small database helper for local operator tasks (migrations, imports).
//
// There is no psql, no migration runner and no Application Default Credentials
// on the operator machine, and Cloud SQL has no authorized networks. So we go
// through the Cloud SQL Auth Proxy, which this module starts and stops itself,
// authenticating with a short-lived gcloud access token.
//
// Requires: gcloud logged in, and cloud-sql-proxy on PATH or at CLOUD_SQL_PROXY.

import { spawn, execSync } from "node:child_process";
import { createConnection } from "node:net";
import pg from "pg";

// DATE (oid 1082) as the string Postgres stored, not a JS Date at local
// midnight. The default parse serialises a 31 March year end back as
// "2027-03-30T23:00:00.000Z" under British Summer Time. See finance-api/server.js.
pg.types.setTypeParser(1082, (v) => v);

const INSTANCE = "africanstn-research:europe-west1:africastn-db";
const PROJECT = "africanstn-research";
const PORT = Number(process.env.DB_PROXY_PORT || 5433);

function gcloud(args) {
  // gcloud is a .cmd shim on Windows, which Node refuses to spawn without a
  // shell. Build one quoted command string rather than passing an args array
  // with shell:true, which would concatenate them unescaped (DEP0190).
  const cmd = ["gcloud", ...args]
    .map((a) => (/[\s"^&|<>]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(" ");
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`proxy did not open port ${port}`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

// Opens a proxy plus a connected client. Always call release() when done.
export async function connect() {
  const token = gcloud(["auth", "print-access-token"]);
  const password = gcloud([
    "secrets", "versions", "access", "latest",
    "--secret=db-password", `--project=${PROJECT}`,
  ]);

  const proxyBin = process.env.CLOUD_SQL_PROXY || "cloud-sql-proxy";
  const proxy = spawn(proxyBin, [INSTANCE, "--port", String(PORT), "--token", token], {
    stdio: "ignore",
    shell: false,
  });
  proxy.on("error", (e) => {
    throw new Error(
      `could not start ${proxyBin}: ${e.message}. Set CLOUD_SQL_PROXY to its full path.`
    );
  });

  await waitForPort(PORT);

  const client = new pg.Client({
    host: "127.0.0.1",
    port: PORT,
    user: process.env.DB_USER || "africastn_app",
    password,
    database: process.env.DB_NAME || "africastn_os",
  });
  await client.connect();

  const release = async () => {
    try { await client.end(); } catch { /* already closed */ }
    proxy.kill();
  };

  return { client, release };
}

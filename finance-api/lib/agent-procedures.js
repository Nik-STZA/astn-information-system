// Agent roles and procedures for the runner (29 Oct 2026).
//
// Two layers:
//   standard   agents/roles/*.md and agents/procedures/*.md in this image: how
//              STZA's finance team works, the same for every client. They stay
//              on STZA's servers and are never sent to a client.
//   client     rules a client's engagement adds to a standard procedure, replaces
//              it with, or a procedure only that client has. They live in
//              finance.client_procedures (migration 025), and only approved
//              rules reach an agent.
//
// An agent's system prompt carries its role and the practice controls, plus an
// index of the procedures it may open with read_procedure. The full text is read
// on demand, so a question about one bill does not pay for the VAT procedure.

const fs = require("node:fs");
const path = require("node:path");

const AGENTS_DIR = path.join(__dirname, "..", "agents");

// "key: value" lines between --- fences. Lists are comma-separated.
function parse(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const k of ["tools", "procedures", "roles"]) {
    if (meta[k] !== undefined) meta[k] = meta[k].split(",").map((s) => s.trim()).filter(Boolean);
  }
  return { meta, body: m[2].trim() };
}

function readDir(dir) {
  const full = path.join(AGENTS_DIR, dir);
  return fs.readdirSync(full).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const { meta, body } = parse(fs.readFileSync(path.join(full, f), "utf8"), `${dir}/${f}`);
    if (meta.name !== f.replace(/\.md$/, "")) throw new Error(`${dir}/${f}: name ${meta.name} does not match the file`);
    return { ...meta, body };
  });
}

let cache = null;
function library() {
  if (!cache) {
    const roles = Object.fromEntries(readDir("roles").map((r) => [r.name, r]));
    const procedures = Object.fromEntries(readDir("procedures").map((p) => [p.name, p]));
    cache = { roles, procedures };
  }
  return cache;
}

// Always in the prompt, for every agent: the rules a procedure cannot override.
const PRELOADED = ["practice-controls", "how-work-moves"];

// The procedures one agent may open: those its role names, then any procedure
// that lists the role, then the client's own. Client rules for a procedure the
// agent cannot open are not shown to it.
function proceduresFor(agent, clientRules = []) {
  const { roles, procedures } = library();
  const role = roles[agent];
  const names = new Set(role?.procedures ?? Object.keys(procedures).filter((n) => !PRELOADED.includes(n)));
  for (const p of Object.values(procedures)) if (role && (p.roles || []).includes(agent)) names.add(p.name);
  for (const n of PRELOADED) names.delete(n);

  const out = [...names].filter((n) => procedures[n]).map((n) => ({
    name: n, summary: procedures[n].summary, version: procedures[n].version, standard: true,
    client_rules: clientRules.some((r) => r.procedure === n),
  }));
  for (const r of clientRules) {
    if (procedures[r.procedure] || out.some((o) => o.name === r.procedure)) continue;
    if (r.roles?.length && role && !r.roles.includes(agent)) continue;
    out.push({ name: r.procedure, summary: r.summary || r.title || "Client procedure", version: r.version ?? null, standard: false, client_rules: true });
  }
  return out;
}

// The system prompt for one agent: base, role, the preloaded procedures, the
// index. Unknown agent (a general session): base, preloaded, everything.
function systemPrompt(agent, base, clientRules = []) {
  const { roles, procedures } = library();
  const role = roles[agent];
  const preloaded = PRELOADED.map((n) => withClientRules(procedures[n], clientRules)).join("\n\n");
  const index = proceduresFor(agent, clientRules)
    .map((p) => `- ${p.name}: ${p.summary}${p.standard ? "" : " (this client's own procedure)"}${p.standard && p.client_rules ? " This client has its own rules for it." : ""}`)
    .join("\n");
  return [
    base,
    role ? role.body : "You are working as a general member of the finance team for this client. No single role applies.",
    preloaded,
    `# Procedures you can open\n\nRead the procedure with read_procedure before you do the work it covers, every time: they change, and the client's rules are in them. If no procedure covers the task, say so in your answer rather than inventing one.\n\n${index || "- None."}`,
  ].join("\n\n");
}

// A procedure's text with the client's approved rules after it.
function withClientRules(proc, clientRules) {
  const rules = clientRules.filter((r) => r.procedure === proc.name);
  const replaced = rules.find((r) => r.kind === "replacement");
  const head = `# ${proc.title || proc.name} (standard procedure ${proc.name}, version ${proc.version})`;
  if (replaced) {
    return `# ${proc.title || proc.name} (this client's own version, replacing standard ${proc.name})\n\n${replaced.body}`;
  }
  const additions = rules.filter((r) => r.kind === "addition");
  if (!additions.length) return `${head}\n\n${proc.body}`;
  return `${head}\n\n${proc.body}\n\n## Client rules for this client\n\nThese were agreed for this client and take precedence over the standard text above where the two differ.\n\n${additions.map((r) => r.body.trim()).join("\n\n")}`;
}

function readProcedure(agent, name, clientRules = []) {
  const allowed = proceduresFor(agent, clientRules);
  const hit = allowed.find((p) => p.name === name);
  if (!hit) {
    return { error: `No procedure ${name} for this role.`, available: allowed.map((p) => p.name) };
  }
  const { procedures } = library();
  if (hit.standard) return { name, version: hit.version, text: withClientRules(procedures[name], clientRules) };
  const own = clientRules.find((r) => r.procedure === name);
  return { name, version: own.version ?? null, text: `# ${own.title || name} (this client's own procedure)\n\n${own.body}` };
}

function readProcedureTool(agent, clientRules = []) {
  return {
    name: "read_procedure",
    description:
      "Open one of the procedures listed in your instructions: how STZA does that piece of work, with this client's own rules " +
      "at the end where it has any. Read it before doing the work it covers.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", enum: proceduresFor(agent, clientRules).map((p) => p.name) } },
      required: ["name"],
    },
  };
}

// The tools a role may call, from its front matter. Unknown agent: all of them.
function toolsFor(agent, allTools) {
  const role = library().roles[agent];
  if (!role?.tools) return allTools;
  const allow = new Set([...role.tools, "read_procedure"]);
  return allTools.filter((t) => allow.has(t.name));
}

module.exports = { library, proceduresFor, systemPrompt, readProcedure, readProcedureTool, toolsFor, parse, PRELOADED };

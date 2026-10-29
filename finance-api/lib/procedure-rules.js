// Client rules for the agents' standard procedures (migration 025), as people
// write and approve them on a client's Procedures page in os.stza.io.
// agent-procedures.js merges the approved ones into what an agent reads; this
// file holds the rules for writing them. server.js reads and writes.
//
//   addition     appended to a standard procedure; takes precedence where the
//                two differ
//   replacement  the client's own version of a standard procedure, in full
//   own          a procedure only this client has
//
// A rule starts as a draft. Approving it puts it in front of the agents.
// Editing an approved rule makes it a draft again, at the next version, so
// changed words never reach an agent unapproved.

const { PRELOADED } = require("./agent-procedures");

const KINDS = ["addition", "replacement", "own"];
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LIMITS = { title: 120, summary: 300, body: 20000 };

const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const clean = (v) => (blank(v) ? null : String(v).trim());

// A new rule (current null) or a change to one. lib is agent-procedures'
// library(). Returns { set, issues }; set holds only the fields to write.
function ruleChanges(body = {}, current = null, lib) {
  const set = {};
  const issues = [];
  const procedure = current ? current.procedure : clean(body.procedure);
  const kind = current ? current.kind : clean(body.kind);

  if (current?.status === "retired") return { set, issues: ["A retired rule cannot be changed. Write a new one."] };
  if (!current) {
    if (!procedure || !NAME.test(procedure)) issues.push("The procedure needs a name in lower case with hyphens, such as stock-count.");
    if (!KINDS.includes(kind)) issues.push("A rule adds to a standard procedure, replaces it, or is the client's own procedure.");
    if (issues.length) return { set, issues };
    const standard = lib.procedures[procedure];
    if (kind !== "own" && !standard) issues.push(`There is no standard procedure ${procedure} to ${kind === "addition" ? "add to" : "replace"}.`);
    if (kind === "own" && standard) issues.push(`${procedure} is a standard procedure. Add to it or replace it instead.`);
    if (kind === "replacement" && PRELOADED.includes(procedure)) {
      issues.push(`${standard.title || procedure} cannot be replaced: a client's rules may tighten it, never set it aside. Add to it instead.`);
    }
    set.procedure = procedure;
    set.kind = kind;
  }

  for (const [k, max] of Object.entries(LIMITS)) {
    if (!(k in body) && (current || k !== "body")) continue;
    const v = clean(body[k]);
    if (k === "body" && !v) { issues.push("The rule needs its text."); continue; }
    if (v && v.length > max) { issues.push(`The ${k} is longer than ${max.toLocaleString("en-GB")} characters.`); continue; }
    set[k] = v;
  }
  if (kind === "own" && !(set.title ?? current?.title)) issues.push("A client's own procedure needs a title.");

  if ("roles" in body) {
    const roles = Array.isArray(body.roles) ? [...new Set(body.roles.map(String))] : null;
    if (roles === null && !blank(body.roles)) issues.push("Roles must be a list.");
    else if (roles?.length && kind !== "own") issues.push("Only a client's own procedure names its roles. A standard procedure is open to the roles the standard sets.");
    else if (roles?.some((r) => !lib.roles[r])) issues.push(`Roles must be among ${Object.keys(lib.roles).join(", ")}.`);
    else set.roles = roles?.length ? roles : null;
  }

  // Changed words on an approved rule go back for approval.
  if (current?.status === "approved" && ["title", "summary", "body", "roles"].some((k) => k in set && !same(set[k], current[k]))) {
    Object.assign(set, { status: "draft", version: current.version + 1, approved_by: null, approved_at: null });
  }
  return { set, issues };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The roles that open a standard procedure: every role for the preloaded
// ones, else those whose front matter lists it or that it lists.
function rolesFor(name, lib) {
  if (PRELOADED.includes(name)) return Object.keys(lib.roles);
  const p = lib.procedures[name];
  return Object.values(lib.roles)
    .filter((r) => (r.procedures || []).includes(name) || (p?.roles || []).includes(r.name))
    .map((r) => r.name);
}

// The standard set as a person browses it.
function standardList(lib) {
  return Object.values(lib.procedures).map((p) => ({
    name: p.name, title: p.title || p.name, summary: p.summary, version: p.version,
    roles: rolesFor(p.name, lib), always_loaded: PRELOADED.includes(p.name),
  })).sort((a, b) => Number(b.always_loaded) - Number(a.always_loaded) || a.title.localeCompare(b.title));
}

module.exports = { KINDS, ruleChanges, rolesFor, standardList };

// The client master (migration 029): one record per client, shared by every
// service. Pure rules here; the routes in server.js do the reads and writes.
//
// A client's status says where it sits with us; its services say what it
// takes. A service with no row is not taken; active shows its sections under
// the client; completed moves them to Past, read-only. Nothing is deleted.

const STATUSES = ["prospect", "engaged", "former", "internal"];
const STAGES = ["lead", "discussion", "proposal", "agreed"];
const SERVICES = ["finance", "data_protection", "consulting"];
const SERVICE_STATES = ["active", "completed"];

// The fields a person may change on the client record, with their limits.
const TEXT_FIELDS = { name: 120, legal_name: 200, jurisdiction: 80, contact: 200, lead_email: 200, ended_reason: 500 };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// "Feldspar Sport Group" -> "feldspar-sport-group". Never empty.
function slugify(name) {
  const s = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "client";
}

// The first free slug: base, base-2, base-3...
function freeSlug(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

// Validates a change to the client record. Returns { set, issues }: set holds
// only the fields that were sent and valid, as column -> value.
function clientChanges(body, current = null) {
  const b = body && typeof body === "object" ? body : {};
  const set = {};
  const issues = [];

  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    if (!(field in b)) continue;
    const v = b[field] == null ? null : String(b[field]).trim();
    if (field === "name" && !v) issues.push("A client needs a name.");
    else if (v && v.length > max) issues.push(`${field} is longer than ${max} characters.`);
    else if (field === "lead_email" && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) issues.push("lead_email is not an email address.");
    else set[field] = v || null;
  }

  if ("status" in b) {
    if (!STATUSES.includes(b.status)) issues.push(`status must be one of ${STATUSES.join(", ")}.`);
    else set.status = b.status;
  }
  if ("pipeline_stage" in b) {
    if (b.pipeline_stage !== null && !STAGES.includes(b.pipeline_stage)) issues.push(`pipeline_stage must be one of ${STAGES.join(", ")}, or null.`);
    else set.pipeline_stage = b.pipeline_stage;
  }

  // A stage belongs to a prospect: leaving the pipeline clears it, entering it
  // starts at lead unless a stage was given.
  const status = set.status ?? current?.status;
  if (status && status !== "prospect") {
    if (set.pipeline_stage) issues.push("Only a prospect has a pipeline stage.");
    else if (current?.pipeline_stage || "pipeline_stage" in set) set.pipeline_stage = null;
  } else if (set.status === "prospect" && !set.pipeline_stage && !current?.pipeline_stage) {
    set.pipeline_stage = "lead";
  }

  return { set, issues };
}

// Validates a change to one service. state null means not taken (the row goes).
function serviceChange(service, body) {
  const b = body && typeof body === "object" ? body : {};
  const issues = [];
  if (!SERVICES.includes(service)) issues.push(`service must be one of ${SERVICES.join(", ")}.`);
  const state = b.state === undefined ? undefined : b.state;
  if (state !== null && !SERVICE_STATES.includes(state)) issues.push(`state must be active, completed or null (not taken).`);
  for (const f of ["started_on", "ended_on"]) {
    if (b[f] != null && !isDate(String(b[f]))) issues.push(`${f} must be a date, YYYY-MM-DD.`);
  }
  const note = b.closing_note == null ? null : String(b.closing_note).trim();
  if (note && note.length > 1000) issues.push("closing_note is longer than 1,000 characters.");
  if (state === "active" && (b.ended_on || note)) issues.push("An active service has no end date or closing note.");
  if (issues.length) return { issues };
  return {
    issues,
    state,
    started_on: b.started_on || null,
    ended_on: state === "completed" ? b.ended_on || null : null,
    closing_note: state === "completed" ? note || null : null,
  };
}

// The history line for a change: only what actually changed.
function diff(before, set) {
  const out = {};
  for (const [k, v] of Object.entries(set)) if ((before?.[k] ?? null) !== (v ?? null)) out[k] = { from: before?.[k] ?? null, to: v ?? null };
  return out;
}

// The services as the portal reads them: one entry per service, in a fixed
// order, with null for not taken.
function servicesView(rows) {
  return SERVICES.map((service) => {
    const r = rows.find((x) => x.service === service);
    return r
      ? { service, state: r.state, started_on: r.started_on, ended_on: r.ended_on, closing_note: r.closing_note }
      : { service, state: null, started_on: null, ended_on: null, closing_note: null };
  });
}

module.exports = { STATUSES, STAGES, SERVICES, slugify, freeSlug, clientChanges, serviceChange, diff, servicesView };

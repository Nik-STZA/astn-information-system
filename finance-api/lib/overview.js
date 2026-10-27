// The Finance Overview: where every client is, on one page (redesign step 2,
// 27 Oct 2026). The route reads the rows; this shapes them, so the rules for
// what counts as needing the CFO, blocked or overdue are tested here.

// A status beginning DONE is done; "Partially DONE" is not (the client list's rule).
const DONE = /^\s*done([^a-z0-9]|$)/i;
const isOpen = (o) => !o.is_closed && !DONE.test(o.status || "");

// One client's row. rows: everything the route read for this client.
function clientSummary({ client, entities = 0, apItems = [], wip = [], openItems = [], runs = [], packs = [] }, today) {
  const open = openItems.filter(isOpen);
  const lastRun = runs[0] || null;
  const pack = packs[0] || null;
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 864e5).toISOString();
  return {
    slug: client.slug,
    name: client.name,
    currency: client.reporting_currency,
    entities,
    bills: {
      for_you: apItems.filter((i) => i.state === "exception").length,
      ready: apItems.filter((i) => i.state === "clean" || i.state === "approved").length,
      sent_this_week: apItems.filter((i) => i.state === "written" && i.written_at && new Date(i.written_at).toISOString() >= weekAgo).length,
    },
    approvals: {
      awaiting: wip.filter((w) => w.panel === "awaiting-decision").length,
      blocked: wip.filter((w) => w.panel === "blocked-external").length,
    },
    open_items: {
      open: open.length,
      p1: open.filter((o) => o.priority === "P1").length,
      overdue: open.filter((o) => o.due_at && String(o.due_at).slice(0, 10) < today).length,
    },
    agents: {
      in_flight: runs.filter((r) => r.status === "queued" || r.status === "running").length,
      last: lastRun ? { agent: lastRun.agent, status: lastRun.status, at: lastRun.finished_at || lastRun.queued_at } : null,
    },
    pack: pack ? { period: pack.period, status: pack.status, at: pack.finished_at || pack.queued_at } : null,
  };
}

// Things that are stuck, oldest first: approvals blocked outside, and open
// items past their due date. Each says why and where to go.
function blockers({ client, wip = [], openItems = [] }, today) {
  const out = [];
  for (const w of wip.filter((x) => x.panel === "blocked-external")) {
    out.push({ client: client.name, slug: client.slug, kind: "waiting", title: w.title,
      why: w.blocked_on || "Blocked outside the team", since: w.updated_at, href: `/finance/clients/${client.slug}/approvals` });
  }
  for (const o of openItems.filter(isOpen).filter((x) => x.due_at && String(x.due_at).slice(0, 10) < today)) {
    out.push({ client: client.name, slug: client.slug, kind: "overdue", title: o.title,
      why: `Overdue since ${String(o.due_at).slice(0, 10)}${o.owner_role ? `, with ${o.owner_role}` : ""}`,
      since: o.due_at, href: `/finance/clients/${client.slug}/open-items` });
  }
  return out;
}

// The page's whole payload. byClient: [{ client, entities, apItems, wip, openItems, runs, packs }].
function overview(byClient, today) {
  const clients = byClient.map((c) => clientSummary(c, today));
  const stuck = byClient.flatMap((c) => blockers(c, today))
    .sort((a, b) => String(a.since || "").localeCompare(String(b.since || "")));
  const sum = (f) => clients.reduce((t, c) => t + f(c), 0);
  return {
    today,
    totals: {
      needs_you: sum((c) => c.bills.for_you + c.approvals.awaiting),
      bills_for_you: sum((c) => c.bills.for_you),
      approvals_awaiting: sum((c) => c.approvals.awaiting),
      blocked: stuck.length,
      ready_to_send: sum((c) => c.bills.ready),
      agents_in_flight: sum((c) => c.agents.in_flight),
    },
    clients,
    blocked: stuck.slice(0, 12),
  };
}

module.exports = { clientSummary, blockers, overview, isOpen };

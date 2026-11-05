// The Review inbox routes: read-only. lib/review.js says who each item waits
// on; this reads the rows. There is no write here and there must not be one:
// a bill is decided on Bills, a rec signed on its reconciliation, a journal
// approved on Journals or its rec, each under that screen's own rules.
//
// The queries are the ones the source screens use, narrowed to what is still
// open, so the inbox and the screen cannot disagree about an item's state. A
// source whose table is not there yet (a migration not applied) is skipped and
// named in `missing`, the way the recs list answers migration_missing.

const review = require("./review");

const isMissingTable = (e) => e?.code === "42P01" || e?.code === "42703";

// What each source needs, in words for the page.
const SOURCES = {
  bills: "Bills are waiting for migration 021 to be applied.",
  reconciliations: "Reconciliations are waiting for migration 032 to be applied.",
  journals: "Journals are waiting for migration 033 to be applied.",
  approvals: "The Approvals folders are not in this database.",
  xero_changes: "Xero changes are waiting for migration 039 to be applied.",
};

function mountReview(app, { route, pool, clientIdFromSlug, syncApprovalTasks = null }) {
  const BASE = "/api/finance/clients/:slug/review";

  // Reads one source; a missing table is recorded, anything else is a fault.
  async function source(name, missing, fn) {
    try {
      return await fn();
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      missing.push({ source: name, note: SOURCES[name] });
      return [];
    }
  }

  // The client's inbox for one viewer. One query at a time per source would be
  // slower for no gain; the pool takes them side by side.
  async function inbox(client, actorEmail) {
    const missing = [];
    const slug = client.slug;
    const now = Date.now();

    const [role, activeAgents] = await Promise.all([
      actorEmail
        ? pool.query("SELECT finance.role_at($1,$2,CURRENT_DATE) AS role", [client.id, actorEmail]).then((r) => r.rows[0]?.role ?? null)
        : null,
      // Which agents have work queued or running, as the Bills screen reads it.
      pool.query("SELECT DISTINCT agent FROM finance.agent_runs WHERE client_id = $1 AND status IN ('queued', 'running') AND agent IS NOT NULL", [client.id])
        .then((r) => r.rows.map((x) => x.agent))
        .catch((e) => { if (isMissingTable(e)) return []; throw e; }),
    ]);

    // Each live Approvals item has its Work task before the list is read, so
    // the item can link to it.
    if (syncApprovalTasks) await syncApprovalTasks(client.id);

    const [bills, recRows, recJournals, own, wip, xeroChanges] = await Promise.all([
      source("bills", missing, async () => (await pool.query(
        `SELECT i.id, i.state, i.file_name, i.source, i.created_at, i.decided_at,
                e.slug AS entity_slug, e.name AS entity_name,
                i.proposed_bill->'Contact'->>'Name' AS supplier, i.proposed_bill->>'InvoiceNumber' AS number,
                i.proposed_bill->>'Total' AS total, i.proposed_bill->>'CurrencyCode' AS currency,
                i.review->'reasons' AS reasons,
                i.recommendation IS NOT NULL AS recommended, i.recommendation->>'agent' AS recommendation_agent,
                i.recommendation->>'at' AS recommended_at, i.recommendation->'review'->>'at' AS reviewed_at,
                i.recommendation->'review'->>'verdict' AS review_verdict,
                COALESCE((SELECT jsonb_agg(r->>'agent') FROM jsonb_array_elements(COALESCE(i.recommendation->'reviews', '[]'::jsonb)) r), '[]'::jsonb) AS review_agents
           FROM finance.ap_items i JOIN finance.entities e ON e.id = i.entity_id
          WHERE i.client_id = $1 AND i.state IN ('exception', 'clean', 'approved')`, [client.id])).rows),
      source("reconciliations", missing, async () => (await pool.query(
        `SELECT r.id, r.period, r.status, r.owner, r.prepared_by, r.prepared_at, r.reviewed_at, r.review_note,
                r.recheck_reason, r.dropped_at, r.updated_at, a.account_name
           FROM finance.recs r JOIN finance.rec_accounts a ON a.id = r.rec_account_id
          WHERE r.client_id = $1 AND r.dropped_at IS NULL AND r.status IN ('with_fc', 'with_cfo', 'sent_back')`, [client.id])).rows),
      // The same joins as the rec page and the Journals list, for the retry state.
      source("reconciliations", [], async () => (await pool.query(
        `SELECT j.id, j.jnl_no, j.state, j.narration, j.lines, j.proposed_by, j.approved_at, j.created_at,
                e.name AS entity_name, r.id AS rec_id, r.period, a.account_name,
                ar.status AS run_status, ar.queued_at AS run_queued_at,
                p.outcome AS post_outcome, p.response_body->>'http_status' AS post_http
           FROM finance.rec_journals j
           JOIN finance.recs r ON r.id = j.rec_id
           JOIN finance.rec_accounts a ON a.id = r.rec_account_id
           JOIN finance.entities e ON e.id = j.entity_id
           LEFT JOIN finance.agent_runs ar ON ar.id = j.approved_run_id
           LEFT JOIN finance.journal_posts p ON p.client_id = j.client_id AND p.entity_id = j.entity_id
             AND p.idempotency_key = 'rec-journal-' || j.id || '-' || j.attempts
          WHERE j.client_id = $1 AND j.state IN ('proposed', 'approved')`, [client.id])).rows),
      source("journals", missing, async () => (await pool.query(
        `SELECT j.id, j.jnl_no, j.state, j.period, j.narration, j.lines, j.source, j.proposed_by, j.approved_at, j.created_at, j.last_error,
                e.name AS entity_name,
                p.outcome AS post_outcome, p.response_body->>'http_status' AS post_http, p.created_at AS post_at
           FROM finance.journals j
           JOIN finance.entities e ON e.id = j.entity_id
           LEFT JOIN finance.journal_posts p ON p.client_id = j.client_id AND p.entity_id = j.entity_id
             AND p.idempotency_key = 'journal-' || j.id || '-' || j.attempts
          WHERE j.client_id = $1 AND j.state IN ('proposed', 'approved')`, [client.id])).rows),
      source("approvals", missing, async () => (await pool.query(
        `SELECT w.id, w.ref, w.type, w.status, w.panel, w.title, w.amount_total, w.blocked_on,
                w.drafter_role, w.drafter_email, w.drafter_agent, w.drafted_at, w.updated_at, w.created_at,
                e.name AS entity_name,
                (SELECT t.id FROM finance.tasks t
                  WHERE t.client_id = w.client_id AND t.source = 'approval' AND t.source_ref = w.id::text AND t.deleted_at IS NULL
                  LIMIT 1) AS task_id
           FROM finance.wip_items w LEFT JOIN finance.entities e ON e.id = w.entity_id
          WHERE w.client_id = $1 AND w.panel IN ('awaiting-decision', 'blocked-external', 'in-progress-upstream')
            AND w.closed_at IS NULL`, [client.id])).rows),
      source("xero_changes", missing, async () => (await pool.query(
        `SELECT c.id, c.kind, c.state, c.summary, c.source, c.proposed_by, c.attempt_outcome, c.last_error, c.created_at, c.updated_at,
                c.input->'record'->>'purchasePrice' AS amount, e.name AS entity_name
           FROM finance.xero_changes c JOIN finance.entities e ON e.id = c.entity_id
          WHERE c.client_id = $1 AND c.state IN ('proposed', 'approved')`, [client.id])).rows),
    ]);

    const ctx = { slug, activeAgents, now };
    const waitsAs = review.waitsAs(role);
    const items = review.combine([
      ...bills.map((r) => review.billItem(r, ctx)),
      ...recRows.map((r) => review.recItem(r, ctx)),
      ...recJournals.map((r) => review.recJournalItem(r, ctx)),
      ...own.map((r) => review.journalItem(r, ctx)),
      ...wip.map((r) => review.approvalItem(r, ctx)),
      ...xeroChanges.map((r) => review.xeroChangeItem(r, ctx)),
    ], waitsAs);
    return { viewer: { email: actorEmail || null, role, waits_as: waitsAs }, items, counts: review.counts(items), missing };
  }

  // GET /review   X-Actor-Email optional: with it, items on the viewer's own
  // queue are marked for_you. Without it nothing is.
  app.get(BASE, route(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    res.json(await inbox(client, (req.get("X-Actor-Email") || "").trim()));
  }));

  // GET /review/count   the sidebar's badge: the same reading, counts only.
  app.get(`${BASE}/count`, route(async (req, res) => {
    const client = await clientIdFromSlug(req.params.slug);
    if (!client) return res.status(404).json({ error: "client not found" });
    const out = await inbox(client, (req.get("X-Actor-Email") || "").trim());
    res.json({ ...out.counts, missing: out.missing.map((m) => m.source) });
  }));
}

module.exports = { mountReview, isMissingTable };

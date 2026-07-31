// What the practice actually costs and catches.
//
// Agents make drafting nearly free, so every clerk added multiplies what
// arrives at the review tiers and at the CFO gate. Without measurement the
// only signal that the chain is overloaded is the moment it fails, and the
// failure mode is not a backlog — it is approvals that stop being read.
//
// Nothing here is a judgement about a person. It is a judgement about whether
// a tier is earning its place, which is a question about the design.
//
// Usage:
//   node scripts/practice-metrics.mjs [--client <slug>] [--months 3]

import { connect } from "./db.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const pct = (n, d) => (d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(0).padStart(4)}%`);
const row = (label, ...cols) => console.log(`  ${label.padEnd(24)}${cols.join("")}`);

async function hasColumn(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'finance' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  const slug = arg("--client", null);
  const months = Number(arg("--months", "3"));

  const { client, release } = await connect();
  try {
    const where = slug ? "AND c.slug = $2" : "";
    const params = slug ? [months, slug] : [months];

    console.log(`\nPractice metrics, last ${months} month(s)${slug ? ` — ${slug}` : ""}\n`);

    // ── Volume and send-back rate by drafter ────────────────────────────────
    // A drafter whose work is never sent back is either very good or is being
    // waved through. The number does not say which; it says where to look.
    const drafters = await client.query(
      `SELECT w.drafter_role,
              COUNT(DISTINCT w.id)::int AS items,
              COUNT(*) FILTER (WHERE r.outcome ILIKE 'sent back%')::int AS sent_back,
              COUNT(r.id)::int AS reviews
         FROM finance.wip_items w
         JOIN shared.clients c ON c.id = w.client_id
         LEFT JOIN finance.wip_review_log r ON r.wip_id = w.id
        WHERE w.drafted_at > now() - ($1 || ' months')::interval ${where}
        GROUP BY w.drafter_role
        ORDER BY items DESC`,
      params
    );

    console.log("Drafted");
    row("", "  items", "  returns", "   rate");
    for (const d of drafters.rows) {
      row(
        d.drafter_role ?? "(unrecorded)",
        String(d.items).padStart(7),
        String(d.sent_back).padStart(9),
        pct(d.sent_back, d.items).padStart(7)
      );
    }

    // ── What each review tier catches ───────────────────────────────────────
    // The column that matters. A tier returning nothing over a quarter is
    // either receiving clean work or is not reviewing, and the design should
    // not have to guess which.
    //
    // review.md holds every pair of eyes on the work, which includes the
    // drafter's own Submitted and Resubmitted entries. Those are handoffs, not
    // reviews, and counting them credits a clerk with reviewing its own batch
    // and dilutes every rate below.
    const reviewers = await client.query(
      `SELECT r.reviewer_role,
              COUNT(*)::int AS reviews,
              COUNT(*) FILTER (WHERE r.outcome ILIKE 'sent back%')::int AS sent_back
         FROM finance.wip_review_log r
         JOIN finance.wip_items w ON w.id = r.wip_id
         JOIN shared.clients c ON c.id = w.client_id
        WHERE r.reviewed_at > now() - ($1 || ' months')::interval ${where}
          AND r.outcome NOT ILIKE 'submitted%'
          AND r.outcome NOT ILIKE 'resubmitted%'
        GROUP BY r.reviewer_role
        ORDER BY reviews DESC`,
      params
    );

    console.log("\nReviewed");
    row("", " reviews", "  returns", "   rate");
    for (const r of reviewers.rows) {
      row(
        r.reviewer_role,
        String(r.reviews).padStart(7),
        String(r.sent_back).padStart(9),
        pct(r.sent_back, r.reviews).padStart(7)
      );
    }

    // ── The gate ────────────────────────────────────────────────────────────
    // How much reaches the CFO to be read individually. This is the scarce
    // resource, and it is the number that decides how many clerks the practice
    // can afford.
    if (await hasColumn(client, "wip_items", "routing_class")) {
      const gate = await client.query(
        `SELECT w.routing_class, COUNT(*)::int AS n
           FROM finance.wip_items w
           JOIN shared.clients c ON c.id = w.client_id
          WHERE w.drafted_at > now() - ($1 || ' months')::interval ${where}
          GROUP BY w.routing_class`,
        params
      );
      const total = gate.rows.reduce((a, g) => a + g.n, 0);
      console.log("\nReaching the gate");
      for (const g of gate.rows) {
        row(g.routing_class, String(g.n).padStart(7), pct(g.n, total).padStart(16));
      }
      if (total && !gate.rows.some((g) => g.routing_class === "mechanical")) {
        console.log("\n  Nothing is batching. Either no routing config is set, or its");
        console.log("  thresholds are unset, so every item is read individually.");
      }
    } else {
      console.log("\nReaching the gate");
      console.log("  routing_class column absent — apply migration 007.");
    }

    // ── Cycle time ──────────────────────────────────────────────────────────
    // Drafted to CFO decision. The value proposition is speed with quality; a
    // chain that adds tiers without watching this trades one for the other
    // silently.
    const cycle = await client.query(
      `SELECT w.type,
              COUNT(*)::int AS n,
              ROUND(AVG(EXTRACT(EPOCH FROM (last_review.at - w.drafted_at)) / 86400)::numeric, 1) AS days
         FROM finance.wip_items w
         JOIN shared.clients c ON c.id = w.client_id
         JOIN LATERAL (
           SELECT MAX(r.reviewed_at) AS at FROM finance.wip_review_log r WHERE r.wip_id = w.id
         ) last_review ON true
        WHERE w.status IN ('posted', 'rejected')
          AND w.drafted_at IS NOT NULL
          AND last_review.at IS NOT NULL
          AND w.drafted_at > now() - ($1 || ' months')::interval ${where}
        GROUP BY w.type
        ORDER BY days DESC NULLS LAST`,
      params
    );

    console.log("\nDrafted to decision");
    if (!cycle.rows.length) {
      console.log("  Nothing has completed the chain yet.");
    } else {
      row("", "   items", "     days");
      for (const c of cycle.rows) {
        row(c.type, String(c.n).padStart(8), String(c.days ?? "-").padStart(10));
      }
    }

    // Outcomes are free text in review.md, so the two filters above are
    // exclusions rather than a whitelist. Print the vocabulary actually in use
    // so drift is visible instead of quietly landing in the wrong column.
    const outcomes = await client.query(
      `SELECT r.outcome, COUNT(*)::int AS n
         FROM finance.wip_review_log r
         JOIN finance.wip_items w ON w.id = r.wip_id
         JOIN shared.clients c ON c.id = w.client_id
        WHERE r.reviewed_at > now() - ($1 || ' months')::interval ${where}
        GROUP BY r.outcome ORDER BY n DESC`,
      params
    );
    console.log("\nOutcome vocabulary in use");
    console.log(`  ${outcomes.rows.map((o) => `${o.outcome} (${o.n})`).join(", ") || "none"}`);

    console.log("");
  } finally {
    await release();
  }
}

main().catch((e) => {
  console.error("\nMetrics failed:", e.message);
  process.exit(1);
});

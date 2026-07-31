// Creates example WIP folders so the Approvals queue has something to render
// before real agent work flows through it.
//
// Titles use roles rather than individual names. These surfaces are internal,
// but anything that might inform pack or board content stays anonymised
// (Feldspar CLAUDE.md rule 8).
//
// Idempotent: a folder whose ref already exists on disk is left alone.
//
// Usage:
//   node scripts/seed-wip.mjs [--client feldspar-sport-group] [--dry-run]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const CLIENTS_ROOT = process.env.CLIENTS_ROOT || "C:\\Users\\yogim\\STZA Group\\Clients";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Drawn from the live open-items register so the queue reads like real work.
//
// Drafter roles follow the tier split of 31 July 2026: FM1 drafts, FM2 reviews.
// VAT and balance sheet reconciliations are FM1's; FM2 draws nothing.
const SEEDS = [
  {
    entity: "ultraspeed-digital",
    state: "pending-cfo",
    batch: "2026-07-31-q2-return",
    type: "vat",
    title: "VAT return, quarter ended 30 June 2026",
    amountTotal: "18420.50",
    drafterRole: "FM1",
    priority: "P1",
    reviews: [
      { at: "2026-07-30 11:20", role: "FM2", outcome: "Submitted",
        notes: "Prepared from the July ledger. Reverse charge applied to the EU supplier." },
      { at: "2026-07-31 09:05", role: "FC", outcome: "Approved",
        notes: "Boxes agree to the VAT control account. Ready for CFO." },
    ],
  },
  {
    entity: "feldspar-group-holdings",
    state: "pending-cfo",
    batch: "2026-07-31-legal-accrual-reversal",
    type: "month-end",
    title: "Legal and professional accrual reversal, July",
    amountTotal: "12500.00",
    drafterRole: "FM1",
    priority: "P2",
    reviews: [
      { at: "2026-07-30 16:40", role: "FM1", outcome: "Submitted",
        notes: "Accrual raised in June now invoiced. Reversal posts against the same code." },
      { at: "2026-07-31 10:15", role: "FC", outcome: "Approved",
        notes: "Ties to the supplier invoice. No further accrual needed." },
    ],
  },
  {
    entity: null,
    state: "pending-cfo",
    batch: "2026-07-31-payment-run",
    type: "ap",
    title: "Weekly payment run, week commencing 28 July",
    amountTotal: "42317.88",
    drafterRole: "AP Clerk",
    priority: "P1",
    reviews: [
      { at: "2026-07-30 09:30", role: "AP Clerk", outcome: "Submitted",
        notes: "14 invoices, all matched to purchase orders or approved spend." },
      { at: "2026-07-30 15:00", role: "FM2", outcome: "Sent back",
        findings: ["One supplier not on the approved vendor list"],
        nextStep: "AP Clerk to confirm the vendor or remove the line" },
      { at: "2026-07-31 08:45", role: "AP Clerk", outcome: "Resubmitted",
        notes: "Vendor confirmed and added to the register. 14 invoices unchanged." },
      { at: "2026-07-31 11:30", role: "FC", outcome: "Approved", notes: "Cleared for payment." },
    ],
  },
  {
    entity: null,
    state: "pending-cfo",
    batch: "2026-07-31-pack-sign-off",
    type: "month-end",
    title: "July management pack, sign-off",
    amountTotal: null,
    drafterRole: "FC",
    priority: "P2",
    reviews: [
      { at: "2026-07-31 12:00", role: "FC", outcome: "Submitted",
        notes: "Balance Control within threshold. Commentary drafted for CFO review." },
    ],
  },
  // Upstream work, so the in-progress panel is not empty.
  {
    entity: "feldspar-ltd",
    state: "pending-fc",
    batch: "2026-07-29-batch",
    type: "ap",
    title: "AP batch, 9 supplier invoices",
    amountTotal: "8940.12",
    drafterRole: "AP Clerk",
    priority: "P3",
    reviews: [{ at: "2026-07-29 14:10", role: "FM2", outcome: "Approved", notes: "Coding checked." }],
  },
  {
    entity: "feldspar-ltd",
    state: "sent-back",
    batch: "2026-07-28-bank-rec",
    type: "reconciliation",
    title: "Bank reconciliation at 31 July",
    amountTotal: null,
    drafterRole: "FM1",
    priority: "P2",
    reviews: [
      { at: "2026-07-28 16:20", role: "FM2", outcome: "Submitted" },
      { at: "2026-07-29 09:00", role: "FC", outcome: "Sent back",
        findings: ["Two travel receipts still outstanding"],
        nextStep: "FM2 to complete once receipts are in" },
    ],
  },
];

function reviewMarkdown(reviews) {
  return reviews
    .map((r) => {
      const parts = [`## ${r.at} - ${r.role}`, "", `**Outcome:** ${r.outcome}`];
      if (r.findings?.length) {
        parts.push("**Findings:**", ...r.findings.map((f) => `- ${f}`));
      }
      if (r.nextStep) parts.push(`**Next step:** ${r.nextStep}`);
      if (r.notes) parts.push(`**Notes:** ${r.notes}`);
      return parts.join("\n");
    })
    .join("\n\n") + "\n";
}

function main() {
  const slug = arg("--client", "feldspar-sport-group");
  const dryRun = process.argv.includes("--dry-run");
  const clientRoot = join(CLIENTS_ROOT, slug);

  if (!existsSync(clientRoot)) throw new Error(`client folder not found: ${clientRoot}`);

  let created = 0;
  let skipped = 0;

  for (const s of SEEDS) {
    // Live work is wip/<state>/<type>/<batch>. Finished work leaves wip
    // entirely: <posted|rejected>/<YYYY>/<MM>/<type>/<batch>.
    const archived = s.state === "posted" || s.state === "rejected";
    const stateDir = archived
      ? join(s.state, s.archivedYear ?? "2026", s.archivedMonth ?? "07", s.type)
      : join("wip", s.state, s.type);
    const rel = s.entity
      ? join("entities", s.entity, stateDir, s.batch)
      : join(stateDir, s.batch);
    const abs = join(clientRoot, rel);

    if (existsSync(abs)) {
      skipped++;
      continue;
    }

    const manifest = {
      ref: randomUUID(),
      type: s.type,
      entityScope: s.entity ? "entity" : "group",
      entity: s.entity,
      title: s.title,
      amountTotal: s.amountTotal,
      currency: "GBP",
      drafterRole: s.drafterRole,
      draftedAt: "2026-07-31T09:00:00Z",
      priority: s.priority,
    };

    console.log(`  ${dryRun ? "would create" : "created"}  ${rel.replace(/\\/g, "/")}`);
    if (!dryRun) {
      mkdirSync(join(abs, "artefacts"), { recursive: true });
      writeFileSync(join(abs, "wip.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      writeFileSync(join(abs, "review.md"), reviewMarkdown(s.reviews), "utf-8");
    }
    created++;
  }

  console.log("");
  console.log(`${created} folder(s) ${dryRun ? "would be created" : "created"}, ${skipped} already present.`);
  if (dryRun) console.log("Dry run. Nothing written.");
}

try {
  main();
} catch (e) {
  console.error("Seeding failed:", e.message);
  process.exit(1);
}

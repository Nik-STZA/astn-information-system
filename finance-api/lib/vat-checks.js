// The checks on a VAT return's uploads (VAT build spec 17 Nov 2026, section 5).
// Pure: each takes parsed exports (lib/vat-export.js) and says what is wrong,
// in a person's words, and whether it blocks the return going further.
//
//   1 period            every export covers the return's period          blocking
//   2 members complete  one export for every member on the period end    blocking
//   3 ledger tie        box 1 and 4 against the VAT control's movement   (needs Xero: the upload route)
//   4 late claims       listed by original date and account              shown
//   5 adjustments with no accounting transaction need a reason and the
//     CFO's acceptance                                                   blocking until accepted
//   6 box arithmetic    box 3 = 1 + 2; box 5 = |3 - 4|, its label says which way   blocking

const { netPosition } = require("./vat-export");

const p = (n) => Math.round(Number(n || 0) * 100);
const money = (pence) => (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// exports: [{ entity_id, entity_name, parsed }], ret: { period_start, period_end },
// members: [{ entity_id, entity_name }] on the period end, accepted: Set of
// adjustment line keys the CFO has accepted.
function checkReturn({ exports, ret, members, accepted = new Set() }) {
  const checks = [];
  const add = (key, ok, blocking, said, items = []) => checks.push({ key, ok, blocking: !ok && blocking, said, items });

  // 1 period
  const wrong = exports.filter((x) => x.parsed.period_start !== ret.period_start || x.parsed.period_end !== ret.period_end);
  add("period", !wrong.length, true,
    wrong.length ? `${wrong.map((x) => `${x.entity_name}'s export covers ${x.parsed.period_start} to ${x.parsed.period_end}`).join("; ")}, not ${ret.period_start} to ${ret.period_end}. Export it again for this period.`
      : `Every export covers ${ret.period_start} to ${ret.period_end}.`);

  // 2 members complete
  const have = new Set(exports.map((x) => x.entity_id));
  const missing = members.filter((m) => !have.has(m.entity_id));
  const extra = exports.filter((x) => !members.some((m) => m.entity_id === x.entity_id));
  add("members", !missing.length && !extra.length, true,
    missing.length || extra.length
      ? [missing.length ? `No export yet for ${missing.map((m) => m.entity_name).join(", ")}.` : "", extra.length ? `${extra.map((x) => x.entity_name).join(", ")} is not a member on ${ret.period_end}.` : ""].filter(Boolean).join(" ")
      : `An export for every member: ${members.map((m) => m.entity_name).join(", ")}.`);

  // 6 box arithmetic, per export
  const sums = [];
  for (const x of exports) {
    const b = x.parsed.boxes;
    const issues = [];
    if (p(b[3]) !== p(b[1]) + p(b[2])) issues.push(`box 3 is ${money(p(b[3]))}, boxes 1 and 2 add to ${money(p(b[1]) + p(b[2]))}`);
    const net = netPosition(b);
    if (Math.abs(net) !== p(b[5])) issues.push(`box 5 is ${money(p(b[5]))}, box 3 less box 4 is ${money(net)}`);
    const label = String(x.parsed.box5_label || "").toLowerCase();
    if (net < 0 && label && !label.includes("reclaim")) issues.push("box 5 is a reclaim but its label says payable");
    if (net > 0 && label && label.includes("reclaim")) issues.push("box 5 is payable but its label says reclaim");
    if (issues.length) sums.push(`${x.entity_name}: ${issues.join("; ")}`);
  }
  add("arithmetic", !sums.length, true, sums.length ? sums.join(". ") : "Boxes 3 and 5 follow from boxes 1, 2 and 4 on every export.");

  // 4 late claims
  const late = exports.flatMap((x) => x.parsed.lines
    .filter((l) => (l.kind === "late" || l.kind === "late_adjusted") && (l.box === 1 || l.box === 4) && !l.reverse_charge && !l.memo)
    .map((l) => ({ entity: x.entity_name, ...l })));
  add("late_claims", true, false,
    late.length ? `${late.length} late claim line${late.length === 1 ? "" : "s"}: VAT on transactions dated before this period, claimed now.` : "No late claims.",
    late.map((l) => ({ entity: l.entity, box: l.box, date: l.date, account: l.account_code ? `${l.account} (${l.account_code})` : l.account, reference: l.reference, vat: l.vat })));

  // 5 adjustments with no accounting transaction (imports are checked
  // separately against the import log; they appear as "Imported VAT box amount")
  const adj = exports.flatMap((x) => x.parsed.lines.filter((l) => l.kind === "no_transaction")
    .map((l) => ({ entity: x.entity_name, key: adjustmentKey(x.entity_id, l), ...l })));
  const open = adj.filter((a) => !accepted.has(a.key));
  add("adjustments", !open.length, true,
    !adj.length ? "No adjustments without an accounting transaction."
      : open.length ? `${open.length} adjustment${open.length === 1 ? "" : "s"} with no accounting transaction need a reason and evidence, accepted by the CFO.`
        : `${adj.length} adjustment${adj.length === 1 ? "" : "s"} with no accounting transaction, each accepted with its reason.`,
    adj.map((a) => ({ key: a.key, entity: a.entity, box: a.box, date: a.date, created_on: a.created_on, details: a.details, vat: a.vat, net: a.net, accepted: accepted.has(a.key) })));

  return { checks, blocking: checks.filter((c) => c.blocking).map((c) => c.key), ok: checks.every((c) => !c.blocking) };
}

// A stable key for one adjustment line within a company's return.
const adjustmentKey = (entityId, l) => [entityId, l.box, l.date, l.created_on ?? "", l.details ?? "", p(l.vat), p(l.net)].join("|");

module.exports = { checkReturn, adjustmentKey };

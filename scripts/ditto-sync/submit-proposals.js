#!/usr/bin/env node
/*
 * Step 5 — queue proposals for admin approval in Kavach.
 *
 *   node scripts/ditto-sync/submit-proposals.js            # dry run (default)
 *   node scripts/ditto-sync/submit-proposals.js --submit   # actually POST
 *
 * Nothing goes live here: each change becomes a pending PlanChangeProposal that
 * an admin approves at /kavach/settings/insurance-compare.
 *
 * Duplicate guard: there is no public endpoint listing PENDING proposals, so a
 * rebuild while a batch is still awaiting approval would regenerate the same
 * changes and double-queue them. submitted.json (committed) records every sent
 * change; a plan field is skipped while its last submitted value differs from
 * the live catalog — i.e. it may still be pending. Once approved, the catalog
 * matches and the field is eligible again. If an admin REJECTED a change, the
 * field stays skipped until you pass --resubmit.
 *
 * --only limits a run to specific fields (comma-separated insurer::plan::field).
 * Pair it with --resubmit to resend one rejected change without double-queuing
 * everything else that is still pending:
 *   node scripts/ditto-sync/submit-proposals.js --resubmit --only niva::re20::claimSettlementRatio --submit
 *
 * Also refuses a catalog snapshot older than 6h (--force to override): a stale
 * snapshot re-proposes values that were approved since.
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API, PROVIDERS, readOut } = require("./lib");

const SUBMIT = process.argv.includes("--submit");
const RESUBMIT = process.argv.includes("--resubmit");
const FORCE = process.argv.includes("--force");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  if (i < 0) return null;
  if (!process.argv[i + 1] || process.argv[i + 1].startsWith("--")) { console.error("--only needs insurer::plan::field[,...]"); process.exit(1); }
  return new Set(process.argv[i + 1].split(",").map((x) => x.trim()));
})();
const LEDGER = path.join(__dirname, "submitted.json");
const MAX_AGE_H = 6;

const built = readOut("proposals.json");
const snap = readOut("catalog.json");
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { entries: [] };

const ageH = (Date.now() - Date.parse(snap.fetchedAt)) / 36e5;
if (ageH > MAX_AGE_H && !FORCE) {
  console.error(`catalog snapshot is ${ageH.toFixed(1)}h old — run fetch-catalog + build-proposals again (or --force)`);
  process.exit(1);
}
if (built.catalogFetchedAt !== snap.fetchedAt) {
  console.error("proposals.json was built from a different catalog snapshot — rerun build-proposals");
  process.exit(1);
}

const liveValue = (ik, plk, field) => {
  const pl = snap.catalog.insurers[ik] && snap.catalog.insurers[ik].plans[plk];
  return pl ? String(pl[field] ?? "") : null;
};
// Most recent ledger value per plan field.
const lastSent = new Map();
for (const e of ledger.entries) lastSent.set(`${e.insurerKey}::${e.planKey}::${e.field}`, e);

const toSend = [], skipped = [];
for (const p of built.proposals) {
  const k = `${p.insurerKey}::${p.planKey}::${p.field}`;
  if (ONLY && !ONLY.has(k)) continue;
  const prev = lastSent.get(k);
  const maybePending = prev && prev.newValue !== liveValue(p.insurerKey, p.planKey, p.field);
  if (maybePending && !RESUBMIT) skipped.push({ k, prev });
  else toSend.push(p);
}

if (ONLY) {
  const unknown = [...ONLY].filter((k) => !built.proposals.some((p) => `${p.insurerKey}::${p.planKey}::${p.field}` === k));
  if (unknown.length) { console.error(`--only: not in current proposals: ${unknown.join(", ")}`); process.exit(1); }
  console.log(`--only: ${[...ONLY].join(", ")}`);
}
console.log(`built ${built.proposals.length} · to send ${toSend.length} · skipped ${skipped.length} (already submitted, not yet live)`);
if (skipped.length) {
  const byBatch = {};
  skipped.forEach((s) => { byBatch[s.prev.batch] = (byBatch[s.prev.batch] || 0) + 1; });
  console.log("  skipped by earlier batch:", byBatch);
}
if (!toSend.length) process.exit(0);
if (!SUBMIT) {
  console.log("\nDRY RUN — pass --submit to queue these for approval:");
  toSend.forEach((p) => console.log(`  ${p.insurerKey}::${p.planKey}::${p.field}  "${p.oldValue}" -> "${p.newValue}"`));
  process.exit(0);
}

(async () => {
  const batch = `ditto-${new Date().toISOString().slice(0, 10)}`;
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const groups = {};
  toSend.forEach((p) => (groups[p.insurerKey] = groups[p.insurerKey] || []).push(p));

  let total = 0;
  for (const [ik, items] of Object.entries(groups)) {
    // The admin UI renders submittedBy + clientName but not `note`, so the
    // provenance a reviewer needs goes in those two fields.
    const body = {
      submittedBy: "Ditto sync script — source: joinditto.in",
      clientName: `Ditto sync ${today} · joinditto.in/health-insurance/${PROVIDERS[ik]}/ · CSR = Ditto 3-yr avg · data correction, not a client comparison`,
      note: "Extracted from Ditto plan pages. CSR/network are insurer-level; plan fields only for reviewed matches (scripts/ditto-sync/matches.json).",
      changes: items.map(({ insurerKey, planKey, planName, field, label, oldValue, newValue }) => ({ insurerKey, planKey, planName, field, label, oldValue, newValue })),
    };
    const r = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { console.error(`  ${ik}: HTTP ${r.status} ${JSON.stringify(j)} — stopping; ledger keeps what succeeded`); break; }
    total += j.submitted;
    const at = new Date().toISOString();
    items.forEach((p) => ledger.entries.push({ insurerKey: p.insurerKey, planKey: p.planKey, field: p.field, newValue: p.newValue, batch, submittedAt: at }));
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
    console.log(`  ${ik.padEnd(15)} queued ${j.submitted}`);
  }
  console.log(`queued ${total} proposal(s) as batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

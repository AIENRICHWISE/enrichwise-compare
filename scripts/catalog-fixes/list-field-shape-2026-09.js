#!/usr/bin/env node
/*
 * Re-shape list fields that are stored as one text blob.
 *
 * The step-4 inline editor sends "Unique feature" as text, and an approved edit
 * was stored that way, so adityabirla::activyuva had uniqueFeatures as a string.
 * The tool iterated over it and every comparison including that plan rendered a
 * blank step 4. The tool now coerces on load and Kavach now splits the text into
 * bullets on approval, so this only repairs what is already stored.
 *
 *   node scripts/catalog-fixes/list-field-shape-2026-09.js            # dry run
 *   node scripts/catalog-fixes/list-field-shape-2026-09.js --submit
 *
 * Needs Kavach with uniqueFeatures as a list field. Shares
 * scripts/ditto-sync/submitted.json as the ledger.
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");
const FIELDS = ["uniqueFeatures"];
// Same split Kavach applies on approval: one bullet per line or • marker.
const toBullets = (text) => String(text).split(/[\r\n]+|\s*[•·▪]\s*/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
// Where the stored text wraps mid-point, the split lands in the wrong place.
// Hand-written bullets, same wording, one point each.
const BY_HAND = {
  "adityabirla::activyuva::uniqueFeatures": [
    "11x coverage in 11 years",
    "2x coverage from day 1",
    "Travel On/OFF — if an insured member is travelling abroad, the policy can be switched off for 15–90 days (15% travel credit at renewal)",
  ],
};

(async () => {
  const r = await fetch(`${KAVACH_API}/catalog/?vertical=health`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`catalog returned HTTP ${r.status} — off the office network?`);
  const catalog = await r.json();
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { entries: [] };
  const lastSent = new Map(ledger.entries.map((e) => [`${e.insurerKey}::${e.planKey}::${e.field}`, e]));

  const changes = [];
  for (const [ik, ins] of Object.entries(catalog.insurers)) {
    for (const [plk, pl] of Object.entries(ins.plans)) {
      for (const field of FIELDS) {
        const v = pl[field];
        if (v == null || Array.isArray(v)) continue;
        const items = BY_HAND[`${ik}::${plk}::${field}`] || toBullets(v);
        if (!items.length) { console.log(`  EMPTY    ${ik}::${plk}::${field} — needs a human`); continue; }
        if (lastSent.has(`${ik}::${plk}::${field}`)) { console.log(`  pending  ${ik}::${plk}::${field}`); continue; }
        changes.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field, label: "Unique feature",
          oldValue: String(v), newValue: JSON.stringify(items) });
        console.log(`  send     ${ik}::${plk}::${field} — text -> ${items.length} bullet(s)`);
        items.forEach((s) => console.log(`             • ${s}`));
      }
    }
  }

  console.log(`\nto send ${changes.length}`);
  if (!changes.length || !SUBMIT) { if (changes.length) console.log("DRY RUN — pass --submit to queue these for approval."); return; }

  const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      submittedBy: "Catalog fix script — list-field shape",
      clientName: "Data repair, wording unchanged: the plan's unique features were stored as one block of text instead of separate points, which blanked the comparison table for that plan · not a client comparison",
      note: "scripts/catalog-fixes/list-field-shape-2026-09.js", changes }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)}`);
  const at = new Date().toISOString(), batch = `list-shape-${at.slice(0, 10)}`;
  changes.forEach((c) => ledger.entries.push({ insurerKey: c.insurerKey, planKey: c.planKey, field: c.field, newValue: c.newValue, batch, submittedAt: at }));
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`queued ${j.submitted} as batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

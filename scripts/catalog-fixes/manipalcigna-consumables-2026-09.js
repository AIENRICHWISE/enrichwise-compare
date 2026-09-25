#!/usr/bin/env node
/*
 * ManipalCigna consumables and the Super Top-up check-up — reported by the
 * insurance team 2026-09-25 while testing, each checked against a source.
 *
 *  Super Top-up      consumables are in the BASE plan, not an add-on:
 *                    manipalcigna.com/hospitalization-cover/super-topup lists
 *                    "Non-medical expenses cover — actual expenses incurred
 *                    towards non-medical items listed under Annexure III"
 *                    (up to ₹2 L, once in 3 policy years). No health check-up:
 *                    the page lists none and Ditto has healthCheckup false.
 *  LifeTime Health   consumables add-on offered — Ditto's add-on list for both
 *  (and India 50L)   catalog entries has "Protector Benefit / Health 360 Shield:
 *                    covers a list of 68 non-medical items as per list I up to
 *                    ₹1,00,000".
 *  Sarvah Uttam      queued earlier (sarvah-2026-09.js), from its own T&C.
 *
 * Marking a benefit in-built (type "inbuilt") makes step 3 show it as included
 * instead of a tickable add-on, so nobody quotes extra premium for it.
 *
 *   node scripts/catalog-fixes/manipalcigna-consumables-2026-09.js            # dry run
 *   node scripts/catalog-fixes/manipalcigna-consumables-2026-09.js --submit
 *
 * Needs Kavach that accepts `type` on any add-on. Shares the usual ledger.
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");

const FIXES = [
  { key: "manipalcigna::enhancesupertopup", field: "addOns.consumables",
    value: { available: true, type: "inbuilt", alias: "Non-medical expenses cover", note: "Annexure III items, up to ₹2 L, once in 3 policy years" },
    why: "insurer's plan page lists non-medical expenses as a base benefit; catalog had it not offered" },
  { key: "manipalcigna::enhancesupertopup", field: "addOns.healthCheckup",
    value: { available: false },
    why: "no health check-up on the plan page; Ditto healthCheckup available=false. Catalog already had available=false but kept the \"inbuilt\" label" },
  { key: "manipalcigna::lifetimehealth", field: "addOns.consumables",
    value: { available: true, type: "addon", alias: "Protector Benefit (Health 360 Shield)", note: "68 non-medical items as per List I, up to ₹1 L" },
    why: "Ditto add-on list for LifeTime Health: addons.protector-benefit, customName Health 360 Shield" },
  { key: "manipalcigna::lifetimehealthindia50lacs", field: "addOns.consumables",
    value: { available: true, type: "addon", alias: "Protector Benefit (Health 360 Shield)", note: "68 non-medical items as per List I, up to ₹1 L" },
    why: "same plan family, matched to Ditto /manipal-cigna/lifetime-health" },
];

const KEYS = ["available", "type", "alias", "note", "frequency", "forWhom", "amount"];
const canonical = (v) => (v == null ? "" : JSON.stringify(Object.fromEntries(KEYS.filter((k) => v[k] !== undefined && (k === "available" || v[k] !== "")).map((k) => [k, v[k]]))));

(async () => {
  const r = await fetch(`${KAVACH_API}/catalog/?vertical=health`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`catalog returned HTTP ${r.status} — off the office network?`);
  const catalog = await r.json();
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { entries: [] };
  const lastSent = new Map(ledger.entries.map((e) => [`${e.insurerKey}::${e.planKey}::${e.field}`, e]));

  const changes = [];
  for (const f of FIXES) {
    const [ik, plk] = f.key.split("::");
    const pl = catalog.insurers[ik] && catalog.insurers[ik].plans[plk];
    if (!pl) { console.log(`  MISSING  ${f.key}`); continue; }
    const live = canonical(pl.addOns && pl.addOns[f.field.slice(7)]), next = canonical(f.value);
    if (live === next) { console.log(`  already  ${f.key}::${f.field}`); continue; }
    const prev = lastSent.get(`${f.key}::${f.field}`);
    if (prev && prev.newValue !== live) { console.log(`  pending  ${f.key}::${f.field}`); continue; }
    changes.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field: f.field,
      label: f.field === "addOns.consumables" ? "Consumables (step 3)" : "Health check-up (step 3)", oldValue: live, newValue: next });
    console.log(`  send     ${f.key}::${f.field}\n             ${live || "(none)"}\n          -> ${next}\n             why: ${f.why}`);
  }

  console.log(`\nto send ${changes.length}`);
  if (!changes.length || !SUBMIT) { if (changes.length) console.log("DRY RUN — pass --submit to queue these for approval."); return; }

  const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      submittedBy: "Catalog fix script — ManipalCigna consumables (team report + insurer page/Ditto)",
      clientName: "Data correction reported by the team while testing: Super Top-up covers non-medical items in the base plan and has no health check-up; LifeTime Health does offer the consumables add-on · not a client comparison",
      note: "scripts/catalog-fixes/manipalcigna-consumables-2026-09.js", changes }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)}`);
  const at = new Date().toISOString(), batch = `mc-consumables-${at.slice(0, 10)}`;
  changes.forEach((c) => ledger.entries.push({ insurerKey: c.insurerKey, planKey: c.planKey, field: c.field, newValue: c.newValue, batch, submittedAt: at }));
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`queued ${j.submitted} as batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

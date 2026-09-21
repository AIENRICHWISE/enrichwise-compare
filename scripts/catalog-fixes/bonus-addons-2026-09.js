#!/usr/bin/env node
/*
 * Make the step-3 bonus add-on truthful.
 *
 * 61 plans offered a bonus add-on that did nothing when ticked: addOns.bonus was
 * "available" but the plan had no ncbBooster (the June refresh dropped every
 * booster except ICICI Elevate's). Using Ditto's per-plan add-on records:
 *
 *  1. Boosters — plans where Ditto lists a bonus add-on ("addons.ncb-super") get
 *     its model. These add-ons REPLACE the base bonus (Care: base 10%/yr to 50%,
 *     add-on 50%/yr to 100% — not 150%), which is how the tool applies boosters.
 *     Base models that contradict Ditto and the plan's own text are fixed with
 *     them. Reviewed by hand (BOOSTERS below).
 *  2. Not offered — plans where Ditto tracks the plan's add-ons and none is a
 *     bonus add-on get addOns.bonus.available = false; step 3 then shows "Not
 *     offered" instead of a dead checkbox. Rule-based. Plans with no Ditto match,
 *     or whose Ditto record lists no add-ons at all, are left alone — no data is
 *     not the same as no add-on.
 *
 *   node scripts/catalog-fixes/bonus-addons-2026-09.js            # dry run
 *   node scripts/catalog-fixes/bonus-addons-2026-09.js --submit
 *
 * Needs out/ditto-plans.json (npm run ditto:fetch) and Kavach f45c50c2, which
 * accepts ncbBooster, addOns.bonus and uncapped (capPct 2000) models. Shares
 * scripts/ditto-sync/submitted.json as the ledger.
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API, readOut, readMatches } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");
const NO_CAP = 2000; // Kavach reads capPct 2000 as "no upper limit"
const model = (rate, cap) => ({ firstBonus: rate, firstYears: 99, thenBonus: rate, capPct: cap });
const NONE = { firstBonus: 0, firstYears: 0, thenBonus: 0, capPct: 0 };

// Reviewed against Ditto's add-on records (addons.ncb-super: percentIncrease /
// maxPercentIncrease) and base ncb (perYear / max). care::supreme's booster was
// queued separately (ncb-audit-2026-09.js); icici::elevate already has one.
const BOOSTERS = [
  { key: "adityabirla::activassureddiamond", booster: model(50, 100), label: "Super Credit — +50% of base per claim-free year, up to 100% (2× total)",
    why: "Ditto add-on +50%/yr max 100%; base 10%/yr to 50% already matches Ditto" },
  { key: "adityabirla::activeonenxt", base: NONE, booster: model(100, 500), label: "Super Credit — +100% of base per claim-free year, up to 500% (6× total)",
    why: "Ditto: no inbuilt bonus, Super Credit add-on +100%/yr max 500%; own text \"Optional add-on only\"" },
  { key: "care::care", base: model(10, 50), booster: model(50, 100), label: "Cumulative Bonus Super — +50% of base per claim-free year, up to 100% (2× total)",
    why: "Ditto base 10%/yr max 50% (own text agrees; model had cap 100%), add-on +50%/yr max 100%" },
  { key: "care::careadvantage", base: model(10, 50), booster: model(50, 100), label: "Cumulative Bonus Super — +50% of base per claim-free year, up to 100% (2× total)",
    why: "Ditto base 10%/yr max 50% (model had 50%/yr), add-on +50%/yr max 100%" },
  { key: "care::supreme", base: model(50, 100),
    why: "Ditto base 50%/yr max 100% (model had 100%/yr); booster queued earlier" },
  { key: "icici::healthsheild360", booster: model(50, 100), label: "Power Booster — +50% of base per claim-free year, up to 100% (2× total)",
    why: "Ditto add-on +50%/yr max 100%; base 20%/yr to 100% already matches Ditto" },
  { key: "manipalcigna::primeprotect", booster: model(50, 200), label: "Cumulative Bonus Booster — +50% of base per claim-free year, up to 200% (3× total)",
    why: "Ditto add-on Cumulative Bonus Booster +50%/yr max 200%; base 25%/yr to 200% already matches" },
  { key: "star::superstar", booster: model(100, NO_CAP), label: "Super Star Bonus — +100% of base per claim-free year, no upper limit",
    why: "Ditto add-on Super Star Bonus +100%/yr, maxPercentIncrease -1 (uncapped); base 50%/yr to 100% matches" },
];

const LABELS = { ncbModel: "No-claim bonus model", ncbBooster: "Bonus booster model (add-on)", ncbBoosterText: "Bonus booster (add-on)", "addOns.bonus": "Bonus add-on (step 3)" };
const canonical = (field, v) => {
  if (v == null) return "";
  if (field === "ncbModel" || field === "ncbBooster") return JSON.stringify({ firstBonus: v.firstBonus, firstYears: v.firstYears, thenBonus: v.thenBonus, capPct: v.capPct });
  if (field === "addOns.bonus") return JSON.stringify(v.alias === undefined ? { available: v.available } : { available: v.available, alias: v.alias });
  return String(v);
};
const liveOf = (pl, field) => (field === "addOns.bonus" ? pl.addOns && pl.addOns.bonus : pl[field]);

(async () => {
  const r = await fetch(`${KAVACH_API}/catalog/?vertical=health`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`catalog returned HTTP ${r.status} — off the office network?`);
  const catalog = await r.json();
  const { plans } = readOut("ditto-plans.json");
  const { matches } = readMatches();
  const byPath = Object.fromEntries(plans.map((d) => [d.path, d]));
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { entries: [] };
  const lastSent = new Map(ledger.entries.map((e) => [`${e.insurerKey}::${e.planKey}::${e.field}`, e]));
  const planOf = (key) => { const [ik, plk] = key.split("::"); return catalog.insurers[ik] && catalog.insurers[ik].plans[plk]; };

  const groups = [
    { submittedBy: "Catalog fix script — bonus boosters (Ditto add-on records)",
      clientName: "Data correction: bonus add-on was selectable but had no model, so ticking it did nothing; restores the add-on's bonus from Ditto (replaces the base while ticked), and fixes base models that contradicted Ditto · not a client comparison",
      items: [] },
    { submittedBy: "Catalog fix script — bonus add-on not offered (Ditto add-on list)",
      clientName: "Data correction: plan listed a bonus add-on, but Ditto's add-on list for this plan has none (several are built-in benefits, not add-ons); step 3 will show \"Not offered\" · not a client comparison",
      items: [] },
  ];
  const want = (group, key, field, value, why) => groups[group].items.push({ key, field, value, why });

  for (const b of BOOSTERS) {
    if (b.base) want(0, b.key, "ncbModel", b.base, b.why);
    if (b.booster) { want(0, b.key, "ncbBooster", b.booster, b.why); want(0, b.key, "ncbBoosterText", b.label, b.why); }
  }
  const confirmed = new Set([...BOOSTERS.map((b) => b.key), "care::supreme", "icici::elevate"]);
  for (const [ik, ins] of Object.entries(catalog.insurers)) {
    for (const [plk, pl] of Object.entries(ins.plans)) {
      const key = `${ik}::${plk}`, bonus = pl.addOns && pl.addOns.bonus;
      if (!bonus || !bonus.available || pl.ncbBooster || confirmed.has(key)) continue;
      const d = matches[key] && byPath[matches[key]];
      const list = d ? d.plan.addonsList || [] : [];
      if (!list.length || list.some((a) => a.__component === "addons.ncb-super")) continue;
      want(1, key, "addOns.bonus", bonus.alias ? { available: false, alias: bonus.alias } : { available: false },
        `Ditto lists ${list.length} add-on(s) for this plan, none a bonus add-on`);
    }
  }

  const batches = [];
  for (const g of groups) {
    const changes = [];
    for (const it of g.items) {
      const pl = planOf(it.key);
      if (!pl) { console.log(`  MISSING  ${it.key}`); continue; }
      const live = canonical(it.field, liveOf(pl, it.field)), next = canonical(it.field, it.value);
      if (live === next) { console.log(`  already  ${it.key}::${it.field}`); continue; }
      const prev = lastSent.get(`${it.key}::${it.field}`);
      if (prev && prev.newValue !== live) { console.log(`  pending  ${it.key}::${it.field}`); continue; }
      const [ik, plk] = it.key.split("::");
      changes.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field: it.field, label: LABELS[it.field], oldValue: live, newValue: next });
      console.log(`  send     ${it.key}::${it.field}\n             ${live || "(none)"}\n          -> ${next}\n             why: ${it.why}`);
    }
    if (changes.length) batches.push({ g, changes });
  }

  const total = batches.reduce((n, b) => n + b.changes.length, 0);
  console.log(`\nto send ${total}: ${batches.map((b) => `${b.changes.length} × ${b.g.submittedBy.split("— ")[1]}`).join(" · ")}`);
  if (!total || !SUBMIT) { if (total) console.log("DRY RUN — pass --submit to queue these for approval."); return; }

  const at = new Date().toISOString(), batch = `bonus-addons-${at.slice(0, 10)}`;
  for (const { g, changes } of batches) {
    const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ submittedBy: g.submittedBy, clientName: g.clientName, note: "scripts/catalog-fixes/bonus-addons-2026-09.js", changes }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)} — earlier group (if any) was queued and logged`);
    changes.forEach((c) => ledger.entries.push({ insurerKey: c.insurerKey, planKey: c.planKey, field: c.field, newValue: c.newValue, batch, submittedAt: at }));
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
    console.log(`  queued ${j.submitted} — ${g.submittedBy}`);
  }
  console.log(`batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

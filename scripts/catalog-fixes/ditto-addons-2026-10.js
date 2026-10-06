#!/usr/bin/env node
/*
 * Fill two step-3 add-ons from Ditto's per-plan add-on records.
 *
 *  roomUpgrade    plans whose Ditto record lists "addons.room-rent-modifier"
 *                 (12 matched plans). The category is new, so every plan reads
 *                 "Not checked for this plan" until something like this fills it.
 *  healthCheckup  plans whose Ditto record lists "addons.annual-health-checkup"
 *                 AND whose catalog entry would otherwise mislead: either it
 *                 says the check-up isn't offered at all, or it is labelled
 *                 in-built while its own text says the opposite ("Paid add-on
 *                 only", "Not in base plan"). Plans whose text reads like a
 *                 genuine in-built benefit are left alone — Ditto's add-on may
 *                 be an upgrade on top, which this script can't tell apart.
 *
 * Only ever asserts what Ditto lists; a plan Ditto doesn't cover is untouched,
 * because no record is not the same as not offered.
 *
 *   node scripts/catalog-fixes/ditto-addons-2026-10.js            # dry run
 *   node scripts/catalog-fixes/ditto-addons-2026-10.js --submit
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API, readOut, readMatches } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");
const ROOM = "addons.room-rent-modifier", CHECKUP = "addons.annual-health-checkup";
// Catalog text that contradicts its own "inbuilt" label.
const SAYS_ADDON = /paid add-?on|not in base|add-?on only|if opted/i;
const KEYS = ["available", "type", "alias", "note", "frequency", "forWhom", "amount"];
const canonical = (v) => (v == null ? "" : JSON.stringify(Object.fromEntries(KEYS.filter((k) => v[k] !== undefined && (k === "available" || v[k] !== "")).map((k) => [k, v[k]]))));

(async () => {
  const r = await fetch(`${KAVACH_API}/catalog/?vertical=health`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`catalog returned HTTP ${r.status} — off the office network?`);
  const catalog = await r.json();
  const { plans } = readOut("ditto-plans.json");
  const { matches } = readMatches();
  const byPath = Object.fromEntries(plans.map((d) => [d.path, d]));
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { entries: [] };
  const lastSent = new Map(ledger.entries.map((e) => [`${e.insurerKey}::${e.planKey}::${e.field}`, e]));

  const changes = [];
  const add = (key, field, value, label, why) => {
    const [ik, plk] = key.split("::");
    const pl = catalog.insurers[ik] && catalog.insurers[ik].plans[plk];
    if (!pl) { console.log(`  MISSING  ${key}`); return; }
    const live = canonical(pl.addOns && pl.addOns[field.slice(7)]), next = canonical(value);
    if (live === next) { console.log(`  already  ${key}::${field}`); return; }
    const prev = lastSent.get(`${key}::${field}`);
    if (prev && prev.newValue !== live) { console.log(`  pending  ${key}::${field}`); return; }
    changes.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field, label, oldValue: live, newValue: next });
    console.log(`  send     ${key}::${field}\n             ${live || "(none)"}\n          -> ${next}\n             why: ${why}`);
  };

  for (const [key, dpath] of Object.entries(matches)) {
    const d = byPath[dpath]; if (!d) continue;
    const list = d.plan.addonsList || [];
    const [ik, plk] = key.split("::");
    const pl = catalog.insurers[ik] && catalog.insurers[ik].plans[plk]; if (!pl) continue;

    const room = list.find((a) => a.__component === ROOM);
    if (room && !(pl.addOns && pl.addOns.roomUpgrade)) {
      add(key, "addOns.roomUpgrade",
        { available: true, type: "addon", alias: room.customName || "Room rent modifier", note: "Lifts the room category the base plan allows" },
        "Room upgrade add-on (step 3)", `Ditto ${dpath} lists ${ROOM}${room.customName ? ` ("${room.customName}")` : ""}`);
    }

    const chk = list.find((a) => a.__component === CHECKUP);
    const hc = (pl.addOns && pl.addOns.healthCheckup) || {};
    const contradicts = hc.available && hc.type === "inbuilt" && SAYS_ADDON.test(String(hc.frequency || ""));
    if (chk && (!hc.available || contradicts)) {
      add(key, "addOns.healthCheckup",
        { available: true, type: "addon", alias: chk.customName || "Annual health check-up", frequency: contradicts ? String(hc.frequency) : "" },
        "Health check-up (step 3)",
        contradicts
          ? `catalog says "${hc.frequency}" but was labelled in-built; Ditto lists ${CHECKUP}`
          : `catalog says not offered, but Ditto ${dpath} lists ${CHECKUP}`);
    }
  }

  console.log(`\nto send ${changes.length}`);
  if (!changes.length || !SUBMIT) { if (changes.length) console.log("DRY RUN — pass --submit to queue these for approval."); return; }

  const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      submittedBy: "Catalog fix script — room upgrade & check-up add-ons (Ditto add-on records)",
      clientName: "Fills the new room-upgrade add-on, and corrects check-ups the catalog called in-built while its own text said \"paid add-on only\" · only plans Ditto actually lists · not a client comparison",
      note: "scripts/catalog-fixes/ditto-addons-2026-10.js", changes }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)}`);
  const at = new Date().toISOString(), batch = `ditto-addons-${at.slice(0, 10)}`;
  changes.forEach((c) => ledger.entries.push({ insurerKey: c.insurerKey, planKey: c.planKey, field: c.field, newValue: c.newValue, batch, submittedAt: at }));
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`queued ${j.submitted} as batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

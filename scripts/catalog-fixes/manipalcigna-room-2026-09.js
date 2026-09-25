#!/usr/bin/env node
/*
 * ManipalCigna room entitlement: base is a single private A/C room, "any room"
 * costs extra. Reported by the insurance team 2026-09-25.
 *
 *  Sarvah Uttam / Param   "Room Rent Modification" is in each plan's own T&C
 *                         (Uttam D.III.9, Param D.III.4, UIN MCIHLIP25035V012425).
 *                         Base room in the catalog already reads "Single Private
 *                         A/C Room; ICU up to sum insured".
 *  LifeTime Health        add-on named "Room Modifier" per the team. NOT in the
 *                         public plan page or Ditto's add-on list, so it needs a
 *                         look at the wording before approving. Its room text
 *                         says only "Covered", corrected here to the base
 *                         entitlement the team gave.
 *
 * roomUpgrade is a new add-on category shipped with the tool; plans without an
 * entry show "Not checked for this plan" rather than claiming it isn't offered.
 *
 *   node scripts/catalog-fixes/manipalcigna-room-2026-09.js            # dry run
 *   node scripts/catalog-fixes/manipalcigna-room-2026-09.js --submit
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");
const upgrade = (alias) => ({ available: true, type: "addon", alias, note: "Lifts the room from single private A/C to any room category" });

const FIXES = [
  { key: "manipalcigna::sarvahuttam", field: "addOns.roomUpgrade", value: upgrade("Room Rent Modification"),
    why: "Sarvah Uttam T&C D.III.9 Room Rent Modification (optional cover)" },
  { key: "manipalcigna::sarvaparam", field: "addOns.roomUpgrade", value: upgrade("Room Rent Modification"),
    why: "Sarvah Param T&C D.III.4 Room Rent Modification (optional cover)" },
  { key: "manipalcigna::lifetimehealth", field: "addOns.roomUpgrade", value: upgrade("Room Modifier"),
    why: "team report; not listed on the insurer's plan page or in Ditto — please check the wording" },
  { key: "manipalcigna::lifetimehealth", field: "roomRent", value: "Single private A/C room (any room category available with the Room Modifier add-on)",
    why: "catalog said only \"Covered\", which tells the advisor nothing" },
];

const KEYS = ["available", "type", "alias", "note"];
const canonical = (field, v) => {
  if (!field.startsWith("addOns.")) return v == null ? "" : String(v);
  return v == null ? "" : JSON.stringify(Object.fromEntries(KEYS.filter((k) => v[k] !== undefined && (k === "available" || v[k] !== "")).map((k) => [k, v[k]])));
};

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
    const liveRaw = f.field.startsWith("addOns.") ? pl.addOns && pl.addOns[f.field.slice(7)] : pl[f.field];
    const live = canonical(f.field, liveRaw), next = canonical(f.field, f.value);
    if (live === next) { console.log(`  already  ${f.key}::${f.field}`); continue; }
    const prev = lastSent.get(`${f.key}::${f.field}`);
    if (prev && prev.newValue !== live) { console.log(`  pending  ${f.key}::${f.field}`); continue; }
    changes.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field: f.field,
      label: f.field === "roomRent" ? "Room rent" : "Room upgrade add-on (step 3)", oldValue: live, newValue: next });
    console.log(`  send     ${f.key}::${f.field}\n             ${live || "(none)"}\n          -> ${next}\n             why: ${f.why}`);
  }

  console.log(`\nto send ${changes.length}`);
  if (!changes.length || !SUBMIT) { if (changes.length) console.log("DRY RUN — pass --submit to queue these for approval."); return; }

  const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      submittedBy: "Catalog fix script — ManipalCigna room upgrade (team report + Sarvah T&C)",
      clientName: "New step-3 add-on: the base plan gives a single private A/C room and \"any room\" costs extra. Sarvah Uttam/Param are in their T&C; LifeTime Health's \"Room Modifier\" is the team's word only — please check the wording · not a client comparison",
      note: "scripts/catalog-fixes/manipalcigna-room-2026-09.js", changes }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)}`);
  const at = new Date().toISOString(), batch = `mc-room-${at.slice(0, 10)}`;
  changes.forEach((c) => ledger.entries.push({ insurerKey: c.insurerKey, planKey: c.planKey, field: c.field, newValue: c.newValue, batch, submittedAt: at }));
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`queued ${j.submitted} as batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

#!/usr/bin/env node
/*
 * ManipalCigna Sarvah Uttam / Param — add-ons and Gullak, from the insurer's own
 * terms (Ditto does not list Sarvah). Both documents: UIN MCIHLIP25035V012425,
 * September 2025.
 *   Uttam  https://www.manipalcigna.com/documents/d/guest/sarvah_uttam_tnc_v1
 *   Param  https://www.manipalcigna.com/documents/d/guest/sarvah_param_tnc_v1
 *
 * Uttam — "D.III Optional covers" lists Health Check Up (D.III.3), Gullak (D.III.6),
 *   Sarathi (D.III.8) and Coverage for Non-Medical Items and Durable Medical
 *   Equipment (D.III.14). The catalog had the check-up as in-built, consumables as
 *   not offered, and Gullak as a base bonus capped at 1500% (T&C: +100% of SI a
 *   year irrespective of claims, "will not exceed 1000%"). There is no base bonus.
 * Param — Gullak is a base benefit (D.I.10), capped at 1000%; the check-up is a
 *   value-added cover (D.II.4, in-built — the catalog is right). There is no bonus
 *   add-on, and maternity appears only as an exclusion (E.I.17).
 *
 *   node scripts/catalog-fixes/sarvah-2026-09.js            # dry run
 *   node scripts/catalog-fixes/sarvah-2026-09.js --submit
 *
 * Needs Kavach with every addOns.* field structured (after f45c50c2, which only
 * had addOns.bonus). Shares scripts/ditto-sync/submitted.json as the ledger.
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");
const model = (rate, cap) => ({ firstBonus: rate, firstYears: 99, thenBonus: rate, capPct: cap });
const NONE = { firstBonus: 0, firstYears: 0, thenBonus: 0, capPct: 0 };
const U = "manipalcigna::sarvahuttam", P = "manipalcigna::sarvaparam";

const FIXES = [
  { key: U, field: "addOns.consumables", value: { available: true, alias: "Non-Medical Items & Durable Medical Equipment" },
    why: "Uttam T&C D.III.14 optional cover: non-medical items up to SI, durable medical equipment up to ₹1 L" },
  { key: U, field: "addOns.healthCheckup",
    value: { available: true, type: "addon", alias: "Health Check Up", frequency: "Annual, cashless at network providers", forWhom: "Insured adults (not dependent children on a floater)" },
    why: "Uttam T&C lists Health Check Up under D.III Optional covers (D.III.3); catalog had it in-built" },
  { key: U, field: "ncbModel", value: NONE,
    why: "Uttam has no base cumulative bonus; Gullak is optional (D.III.6) — moved to the add-on" },
  { key: U, field: "ncbBooster", value: model(100, 1000),
    why: "Gullak: +100% of SI each policy year irrespective of claims, \"will not exceed 1000%\"" },
  { key: U, field: "ncbBoosterText", value: "Gullak — +100% of base every year, even after a claim, up to 1000% (11× total)",
    why: "label shown in the comparison table when the add-on is ticked" },
  { key: U, field: "ncbText", value: "Gullak (optional add-on): 100% increase per year irrespective of claims, max 1000%",
    why: "was \"max 1500%\" with no mention that Gullak is optional" },
  { key: U, field: "addOns.bonus", value: { available: true, alias: "Gullak (Guaranteed Cumulative Bonus)" },
    why: "insurer's name for the optional cover; was \"Cumulative Bonus Booster\"" },
  { key: U, field: "addOns.instantCover", value: { available: true, alias: "Sarathi" },
    why: "Uttam T&C D.III.8 Sarathi; was \"Reduction in PED Waiting\"" },

  { key: P, field: "ncbModel", value: model(100, 1000),
    why: "Param T&C D.I.10 Gullak (base benefit): +100%/yr, \"will not exceed 1000%\"; catalog had 1500%" },
  { key: P, field: "ncbText", value: "Gullak (in-built): 100% increase per year irrespective of claims, max 1000%; plus up to 7.5% renewal discount if claim-free",
    why: "cap 1500% -> 1000% per T&C; renewal-discount wording kept" },
  { key: P, field: "addOns.bonus", value: { available: false, alias: "Cumulative Bonus Booster" },
    why: "Param's optional covers (D.III) have no bonus add-on; Gullak is already in the base plan" },
  { key: P, field: "addOns.maternity", value: { available: false, alias: "Maternity" },
    why: "Param has no maternity cover — only the maternity exclusion E.I.17" },
];

const LABELS = { ncbModel: "No-claim bonus model", ncbBooster: "Bonus booster model (add-on)", ncbBoosterText: "Bonus booster (add-on)", ncbText: "No-claim bonus",
  "addOns.bonus": "Bonus add-on (step 3)", "addOns.consumables": "Consumables add-on (step 3)", "addOns.healthCheckup": "Health check-up (step 3)",
  "addOns.maternity": "Maternity add-on (step 3)", "addOns.instantCover": "Instant cover add-on (step 3)" };
// Same key order Kavach stores, so a live value compares equal to what we'd send.
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && !(k !== "available" && k !== "type" && o[k] === "")).map((k) => [k, o[k]]));
const canonical = (field, v) => {
  if (v == null) return "";
  if (field === "ncbModel" || field === "ncbBooster") return JSON.stringify(pick(v, ["firstBonus", "firstYears", "thenBonus", "capPct"]));
  if (field === "addOns.healthCheckup") return JSON.stringify(pick(v, ["available", "type", "alias", "frequency", "forWhom", "amount"]));
  if (field.startsWith("addOns.")) return JSON.stringify(pick(v, ["available", "alias"]));
  return String(v);
};
const liveOf = (pl, field) => (field.startsWith("addOns.") ? pl.addOns && pl.addOns[field.slice(7)] : pl[field]);

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
    const live = canonical(f.field, liveOf(pl, f.field)), next = canonical(f.field, f.value);
    if (live === next) { console.log(`  already  ${f.key}::${f.field}`); continue; }
    const prev = lastSent.get(`${f.key}::${f.field}`);
    if (prev && prev.newValue !== live) { console.log(`  pending  ${f.key}::${f.field}`); continue; }
    changes.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field: f.field, label: LABELS[f.field], oldValue: live, newValue: next });
    console.log(`  send     ${f.key}::${f.field}\n             ${live || "(none)"}\n          -> ${next}\n             why: ${f.why}`);
  }

  console.log(`\nto send ${changes.length}`);
  if (!changes.length || !SUBMIT) { if (changes.length) console.log("DRY RUN — pass --submit to queue these for approval."); return; }

  const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      submittedBy: "Catalog fix script — Sarvah add-ons (ManipalCigna T&C, Sept 2025)",
      clientName: "Data correction from the insurer's terms: Uttam's check-up and Gullak are optional covers and it does offer consumables; Gullak caps at 1000% not 1500%; Param has no maternity and no bonus add-on · not a client comparison",
      note: "scripts/catalog-fixes/sarvah-2026-09.js", changes }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)}`);
  const at = new Date().toISOString(), batch = `sarvah-${at.slice(0, 10)}`;
  changes.forEach((c) => ledger.entries.push({ insurerKey: c.insurerKey, planKey: c.planKey, field: c.field, newValue: c.newValue, batch, submittedAt: at }));
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`queued ${j.submitted} as batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

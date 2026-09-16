#!/usr/bin/env node
/*
 * Propose ncbModel = no bonus for plans whose own text says they have no bonus.
 *
 * Several plans carried a placeholder ncbModel (50%/yr up to 100%) from the June
 * import although their ncbText says "No", "No bonus" or "Not offered". The tool
 * already refuses to draw that bonus (effectiveNcb treats ncbText as
 * authoritative), but the structured data should agree at source.
 *
 * Uses the same no-bonus test as the tool, so it only ever touches plans the tool
 * already treats as having no bonus. "Add-on only" bonuses are left alone.
 *
 *   node scripts/catalog-fixes/no-bonus-ncb-model.js            # dry run
 *   node scripts/catalog-fixes/no-bonus-ncb-model.js --submit   # queue for approval
 *
 * Needs Kavach with structured-field approvals (monorepo 4746c9f): ncbModel travels
 * as JSON, is shape-checked, and is stored as an object on approval. Shares
 * scripts/ditto-sync/submitted.json as the ledger, so a rerun while these are still
 * pending doesn't queue them again. Needs the office network.
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");
// Keep in step with NO_BONUS_TEXT in index.html.
const NO_BONUS_TEXT = /^\s*(no|nil|none|not offered|not available|no bonus(es)?|no cumulative bonus)\s*\.?\s*$/i;
const NO_BONUS_MODEL = { firstBonus: 0, firstYears: 0, thenBonus: 0, capPct: 0 };
const canonical = (m) => (m ? JSON.stringify({ firstBonus: m.firstBonus, firstYears: m.firstYears, thenBonus: m.thenBonus, capPct: m.capPct }) : "");

(async () => {
  const r = await fetch(`${KAVACH_API}/catalog/?vertical=health`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`catalog returned HTTP ${r.status} — off the office network?`);
  const catalog = await r.json();
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { entries: [] };
  const lastSent = new Map(ledger.entries.map((e) => [`${e.insurerKey}::${e.planKey}::${e.field}`, e]));
  const target = JSON.stringify(NO_BONUS_MODEL);

  const toSend = [], pending = [];
  for (const [ik, ins] of Object.entries(catalog.insurers)) {
    for (const [plk, pl] of Object.entries(ins.plans)) {
      if (!NO_BONUS_TEXT.test(String(pl.ncbText || ""))) continue;
      const live = canonical(pl.ncbModel);
      if (live === target) continue; // already no bonus
      const prev = lastSent.get(`${ik}::${plk}::ncbModel`);
      if (prev && prev.newValue !== live) { pending.push(`${ik}::${plk}`); continue; }
      toSend.push({ insurerKey: ik, planKey: plk, planName: pl.planName, insurerName: ins.name,
        field: "ncbModel", label: "No-claim bonus model", oldValue: live, newValue: target, ncbText: pl.ncbText });
    }
  }

  console.log(`to send ${toSend.length} · skipped ${pending.length} (already queued, not yet live)`);
  toSend.forEach((p) => console.log(`  ${p.insurerKey}::${p.planKey}  ncbText="${p.ncbText}"\n      ${p.oldValue}  ->  ${p.newValue}`));
  if (!toSend.length || !SUBMIT) { if (toSend.length) console.log("\nDRY RUN — pass --submit to queue these for approval."); return; }

  // The admin UI shows submittedBy + clientName, not note — provenance goes there.
  const body = {
    submittedBy: "Catalog fix script — ncbModel vs ncbText",
    clientName: "Data correction: plan text says no bonus, but the bonus model still grew 50%/yr (June import placeholder) · not a client comparison",
    note: "scripts/catalog-fixes/no-bonus-ncb-model.js",
    changes: toSend.map(({ insurerKey, planKey, planName, field, label, oldValue, newValue }) => ({ insurerKey, planKey, planName, field, label, oldValue, newValue })),
  };
  const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)}`);

  const at = new Date().toISOString(), batch = `ncb-no-bonus-${at.slice(0, 10)}`;
  toSend.forEach((p) => ledger.entries.push({ insurerKey: p.insurerKey, planKey: p.planKey, field: p.field, newValue: p.newValue, batch, submittedAt: at }));
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`\nqueued ${j.submitted} proposal(s) as batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

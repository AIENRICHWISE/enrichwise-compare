#!/usr/bin/env node
/*
 * Reviewed fixes from the Sept 2026 audit of the ncbModel placeholder.
 *
 * The June import gave 25 plans the same ncbModel (50%/yr up to 100%). Seven of
 * them have no bonus at all — see no-bonus-ncb-model.js. Of the other 18, ten
 * genuinely are 50%/yr up to 100% (text and Ditto agree) and four are wrong,
 * fixed here. The rest need a source we don't have (see "Not fixed" below).
 *
 * Niva Booster+ carries unused base cover forward, so a claim-free year adds 100%
 * of base; the cap follows the catalog's existing convention for ReAssure
 * (5x base -> 500%, 10x -> 900%) and Ditto's "cover totals ..." figures. Caps are
 * the best case — Niva's multiple depends on entry age.
 *
 * Not fixed:
 *   star::comprehensive, star::starcomprehensive — 50%/yr at 5L cover but 100%/yr
 *     at 7.5L+ (Ditto), both capped at 100%. One model can't vary by sum insured;
 *     the cap is right, only year 1 differs for 7.5L+.
 *   bajaj::etouchii ("—"), manipalcigna::lifetimehealth ("Yes (cumulative bonus)")
 *     — no bonus rate anywhere we can source; Ditto has none. Needs the wording.
 *
 *   node scripts/catalog-fixes/ncb-audit-2026-09.js            # dry run
 *   node scripts/catalog-fixes/ncb-audit-2026-09.js --submit
 *
 * Same ledger (scripts/ditto-sync/submitted.json) and structured-approval
 * requirement (Kavach 4746c9f) as no-bonus-ncb-model.js.
 */
const fs = require("fs");
const path = require("path");
const { KAVACH_API } = require("../ditto-sync/lib");

const SUBMIT = process.argv.includes("--submit");
const LEDGER = path.join(__dirname, "..", "ditto-sync", "submitted.json");
const model = (rate, cap) => ({ firstBonus: rate, firstYears: 99, thenBonus: rate, capPct: cap });

// Each group becomes one submission, so its header states exactly what backs it.
const GROUPS = [
  {
    submittedBy: "Catalog fix script — ncbModel audit (sourced)",
    clientName: "Data correction: bonus model was the June placeholder (50%/yr to 100%); corrected to the plan's text, Ditto and sibling plans · not a client comparison",
    fixes: [
      { key: "star::assure", field: "ncbModel", value: model(25, 100),
        why: "text \"₹2.5L, max ₹10L\" on 10L = 25%/yr; Ditto 25%/yr max 100%; duplicate entry star::healthassure already 25/100" },
      { key: "star::assure", field: "ncbText", value: "25% bonus per claim-free year (upto 100%)",
        why: "match the clearer text of its duplicate, star::healthassure" },
      { key: "niva::aspiregold", field: "ncbModel", value: model(100, 300),
        why: "Booster+ carries unused base forward (+100%/yr claim-free); Ditto: cover totals 2x–4x base, max 300%" },
      { key: "niva::aspiregold", field: "ncbText", value: "Booster+ — carry forward unused base cover; total cover up to 2x–4x base by entry age",
        why: "\"up to 10x\" is the Platinum/Titanium figure; Ditto says 2x–4x for Gold+" },
      { key: "niva::aspirediamond", field: "ncbModel", value: model(100, 500),
        why: "text \"up to 5x base\"; Ditto: cover totals 3x–6x, max 500%" },
    ],
  },
  {
    submittedBy: "Catalog fix script — ncbModel audit (inferred)",
    clientName: "Data correction, INFERRED: plan text says Booster+ up to 10x; no Ditto match, so cap follows ReAssure 3.0's identical text (900%) · please sanity-check · not a client comparison",
    fixes: [
      { key: "niva::aspire", field: "ncbModel", value: model(100, 900),
        why: "own text \"up to 10x base\" = niva::re30's text, modelled 100%/yr cap 900%; Ditto's 10x Aspire variants say total up to 11x" },
    ],
  },
];

const canonical = (v) => (v && typeof v === "object"
  ? JSON.stringify({ firstBonus: v.firstBonus, firstYears: v.firstYears, thenBonus: v.thenBonus, capPct: v.capPct })
  : String(v ?? ""));
const encode = (v) => (typeof v === "object" ? JSON.stringify(v) : v);
const LABELS = { ncbModel: "No-claim bonus model", ncbText: "No-claim bonus" };

(async () => {
  const r = await fetch(`${KAVACH_API}/catalog/?vertical=health`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`catalog returned HTTP ${r.status} — off the office network?`);
  const catalog = await r.json();
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { entries: [] };
  const lastSent = new Map(ledger.entries.map((e) => [`${e.insurerKey}::${e.planKey}::${e.field}`, e]));

  const batches = [];
  for (const g of GROUPS) {
    const changes = [];
    for (const f of g.fixes) {
      const [ik, plk] = f.key.split("::");
      const pl = catalog.insurers[ik] && catalog.insurers[ik].plans[plk];
      if (!pl) { console.log(`  MISSING  ${f.key} — not in catalog, skipped`); continue; }
      const live = canonical(pl[f.field]), want = encode(f.value);
      if (live === canonical(f.value)) { console.log(`  already  ${f.key}::${f.field}`); continue; }
      const prev = lastSent.get(`${f.key}::${f.field}`);
      if (prev && prev.newValue !== live) { console.log(`  pending  ${f.key}::${f.field} (queued earlier, not yet live)`); continue; }
      changes.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field: f.field, label: LABELS[f.field] || f.field,
        oldValue: live, newValue: want });
      console.log(`  send     ${f.key}::${f.field}\n             ${live}\n          -> ${want}\n             why: ${f.why}`);
    }
    if (changes.length) batches.push({ g, changes });
  }

  const total = batches.reduce((n, b) => n + b.changes.length, 0);
  console.log(`\nto send ${total} across ${batches.length} submission(s)`);
  if (!total || !SUBMIT) { if (total) console.log("DRY RUN — pass --submit to queue these for approval."); return; }

  const at = new Date().toISOString(), batch = `ncb-audit-${at.slice(0, 10)}`;
  for (const { g, changes } of batches) {
    const res = await fetch(`${KAVACH_API}/proposals/`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ submittedBy: g.submittedBy, clientName: g.clientName, note: "scripts/catalog-fixes/ncb-audit-2026-09.js", changes }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(`proposals returned HTTP ${res.status} ${JSON.stringify(j)} — earlier groups (if any) were queued and logged`);
    changes.forEach((c) => ledger.entries.push({ insurerKey: c.insurerKey, planKey: c.planKey, field: c.field, newValue: c.newValue, batch, submittedAt: at }));
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
    console.log(`  queued ${j.submitted} — ${g.submittedBy}`);
  }
  console.log(`batch ${batch}. Commit scripts/ditto-sync/submitted.json.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

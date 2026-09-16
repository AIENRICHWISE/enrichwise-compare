#!/usr/bin/env node
/*
 * Step 2 — snapshot the live plan catalog from the Kavach backend.
 * Needs the office network (tools.enrichwise.co.in is IP-allowlisted).
 * Writes out/catalog.json. Re-run right before building proposals so the diff
 * is against current (post-approval) values.
 */
const { KAVACH_API, writeOut } = require("./lib");

(async () => {
  const r = await fetch(`${KAVACH_API}/catalog/?vertical=health`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`catalog returned HTTP ${r.status} — off the office network?`);
  const catalog = await r.json();
  const file = writeOut("catalog.json", { fetchedAt: new Date().toISOString(), catalog });
  console.log(`catalog: ${catalog.planCount} plans, ${Object.keys(catalog.insurers).length} insurers -> ${file}`);
})().catch((e) => { console.error(e.message); process.exit(1); });

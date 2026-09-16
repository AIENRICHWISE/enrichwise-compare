#!/usr/bin/env node
/*
 * Step 3 — validate matches.json and help maintain it.
 *
 *  - every mapped Ditto path must exist in out/ditto-plans.json (slugs are
 *    irregular, e.g. /care/care-freedom-plan, /aditya-birla/Activ-assured-diamond)
 *  - lists catalog plans with no reviewed match, with fuzzy Ditto candidates
 *  - flags matched plans Ditto marks as discontinued
 *
 * Suggestions are only candidates. Confirm it is the same product before adding
 * a match — fuzzy scoring confidently pairs e.g. "Optima Select" with
 * "Optima Secure".
 */
const { PROVIDERS, readOut, readMatches } = require("./lib");

const { plans } = readOut("ditto-plans.json");
const { catalog } = readOut("catalog.json");
const { matches } = readMatches();
const byPath = Object.fromEntries(plans.map((d) => [d.path, d]));

const INSURER_WORDS = /\b(aditya|birla|bajaj|allianz|general|care|health|hdfc|ergo|icici|lombard|iffco|tokio|manipal|manipalcigna|cigna|national|new|india|assurance|niva|bupa|max|oriental|reliance|star|tata|aig|universal|sompo|acko|insurance|plan|policy|the)\b/g;
const tokens = (s) => new Set(String(s).toLowerCase().replace(/\+/g, " plus ").replace(/[^a-z0-9 ]/g, " ")
  .replace(INSURER_WORDS, " ").split(/\s+/).filter(Boolean));
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0; A.forEach((t) => B.has(t) && shared++);
  return shared / (A.size + B.size - shared);
}

let problems = 0;
console.log("== mapped paths ==");
for (const [key, p] of Object.entries(matches)) {
  if (!byPath[p]) { problems++; console.log(`  MISSING  ${key} -> ${p}`); }
  else if (byPath[p].plan.discontinued) console.log(`  DISCONTINUED on Ditto  ${key} -> ${byPath[p].plan.name}`);
}
if (!problems) console.log(`  all ${Object.keys(matches).length} paths resolve`);

console.log("\n== catalog plans without a reviewed match (insurer-level fields only) ==");
for (const [ik, ins] of Object.entries(catalog.insurers)) {
  const provider = PROVIDERS[ik];
  for (const [plk, pl] of Object.entries(ins.plans)) {
    const key = `${ik}::${plk}`;
    if (matches[key]) continue;
    if (!provider) { console.log(`  ${key.padEnd(40)} (insurer not on Ditto)`); continue; }
    const cands = plans.filter((d) => d.provider === provider)
      .map((d) => ({ d, s: Math.max(similarity(pl.planName, d.plan.name), similarity(plk, d.plan.name)) }))
      .sort((a, b) => b.s - a.s).slice(0, 3)
      .map((c) => `${c.d.plan.name} ${c.d.path} (${c.s.toFixed(2)})`);
    console.log(`  ${key.padEnd(40)} "${pl.planName}"\n      candidates: ${cands.join(" | ") || "none"}`);
  }
}
process.exit(problems ? 1 : 0);

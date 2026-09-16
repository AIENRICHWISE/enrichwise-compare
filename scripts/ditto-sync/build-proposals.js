#!/usr/bin/env node
/*
 * Step 4 — diff Ditto against the live catalog and build change proposals.
 *
 * Conservative by design:
 *  - Insurer-level (CSR, network): Ditto publishes one figure per insurer, so
 *    every plan of a mapped insurer is aligned to it.
 *  - Plan-level (coPay, roomRent, prePost, dayCare, ayush): only for plans in
 *    matches.json. Blank values are filled; non-blank values are overwritten
 *    only when a conflict is detected (e.g. "0%" co-pay vs an age-based one).
 *    Wording differences alone never produce a proposal.
 *  - NCB and restore are never proposed: they are structured objects and the
 *    approval flow writes strings.
 *
 * Writes out/proposals.json and prints every overwrite for review.
 */
const { PROVIDERS, SAFE_FIELDS, LABELS, readOut, writeOut, readMatches } = require("./lib");

const ditto = readOut("ditto-plans.json");
const snap = readOut("catalog.json");
const { matches, dropFields } = readMatches();
const drop = new Set((dropFields && dropFields.keys) || []);
const byPath = Object.fromEntries(ditto.plans.map((d) => [d.path, d]));

const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
const blank = (v) => v == null || String(v).trim() === "" || String(v).trim() === "—";
const nums = (v) => (String(v).match(/\d+(\.\d+)?/g) || []).map(Number);

// Ditto structure -> display text in the tool's existing style.
const format = {
  coPay(o) {
    if (!o) return null;
    switch (o.type) {
      case "no-copayment": return "No"; // exact "No" -> green pill + scoring credit
      case "age-based": return o.pct && o.age ? `${o.pct}% for insured aged ${o.age}+` : null;
      case "mandatory": return o.pct ? `${o.pct}% on every claim` : null;
      case "non-network": return o.pct ? `${o.pct}% at non-network hospitals` : null;
      default: return o.comparisonText || null; // "other": only short comparison text, never prose
    }
  },
  roomRent(o) {
    if (!o) return null;
    switch (o.type) {
      case "no-limit": return "No limit";
      case "spr": return "Single private room";
      case "shared-room": return "Shared room";
      case "except-suite": return "Any room except suite";
      case "1pct": return "Up to 1% of sum insured per day";
      case "1pct2icu": return "Up to 1% of sum insured per day (ICU 2%)";
      case "amt": return o.amount ? `Up to ${inr(o.amount)} per day` : null;
      default: return o.comparison || null;
    }
  },
  prePost(o) { return o && o.pre && o.post ? `${o.pre}/${o.post} days${o.limit ? " (capped)" : ""}` : null; },
  dayCare(o) {
    if (!o) return null;
    if (!o.available) return "No";
    if (!o.limit) return "Yes";
    return o.limitType === "pct" && o.limitValue ? `Yes, up to ${o.limitValue}% of sum insured` : "Yes, with limits";
  },
  ayush(o) {
    if (!o) return null;
    if (!o.available) return "No";
    if (!o.limit) return "Yes, up to sum insured";
    if (o.limitType === "amt" && o.limitValue) return `Yes, up to ${inr(o.limitValue)}`;
    if (o.limitType === "pct" && o.limitValue) return `Yes, up to ${o.limitValue}% of sum insured`;
    return "Yes, with limits";
  },
};

// Does a non-blank current value genuinely disagree with Ditto?
const conflicts = {
  coPay(cur, o) {
    const c = String(cur).toLowerCase();
    const none = /^(no|nil|none|0%?)$/.test(c.trim()) || /\bno co-?pay/.test(c);
    if (o.type === "no-copayment") return /\d+\s*%/.test(c) && !/optional|0%\s*standard|voluntary/.test(c) && !none;
    if (o.type === "age-based" || o.type === "mandatory") return none;
    return false;
  },
  roomRent(cur, o) {
    const c = String(cur).toLowerCase();
    const curOpen = /no (room[- ]rent )?(limit|restriction|cap)|any room/.test(c) && !/%|₹|rs\.?\s*\d/.test(c);
    const dittoOpen = o.type === "no-limit" || o.type === "except-suite";
    const dittoTight = ["1pct", "1pct2icu", "amt", "shared-room"].includes(o.type);
    return (dittoOpen && /%|₹|shared/.test(c) && !curOpen) || (dittoTight && curOpen);
  },
  prePost(cur, o) { const n = nums(cur); return n.length >= 2 && (n[0] !== o.pre || n[1] !== o.post); },
  dayCare(cur, o) {
    const c = String(cur).toLowerCase();
    return o.available ? /^no\b|not covered/.test(c) : /^yes|covered/.test(c) && !/not covered/.test(c);
  },
  ayush(cur, o) {
    const c = String(cur).toLowerCase();
    if (!o.available) return /^yes|covered/.test(c) && !/not covered/.test(c);
    if (/^no\b|not covered/.test(c)) return true;
    return o.limit && o.limitType === "amt" && /(sum insured|\bsi\b)/.test(c) && !/₹|rs/.test(c);
  },
};

const proposals = [];
for (const [ik, ins] of Object.entries(snap.catalog.insurers)) {
  const provider = PROVIDERS[ik];
  const metrics = provider && (ditto.plans.find((d) => d.provider === provider && d.providerMetrics) || {}).providerMetrics;
  if (!metrics) continue;

  for (const [plk, pl] of Object.entries(ins.plans)) {
    const key = `${ik}::${plk}`;
    const add = (field, newValue, kind, source) => {
      if (!SAFE_FIELDS.has(field) || drop.has(`${key}::${field}`)) return;
      proposals.push({ insurerKey: ik, planKey: plk, planName: pl.planName, field, label: LABELS[field],
        oldValue: blank(pl[field]) ? "—" : String(pl[field]), newValue, kind, source });
    };

    // CSR stays a bare percentage: computeScores() strips non-digits before
    // parseFloat, so "89% (3-yr avg)" would score as 893.
    if (metrics.claimSettlement != null && nums(pl.claimSettlementRatio)[0] !== Number(metrics.claimSettlement)) {
      add("claimSettlementRatio", `${metrics.claimSettlement}%`, blank(pl.claimSettlementRatio) ? "fill" : "align", `${provider} (insurer)`);
    }
    if (metrics.network != null) {
      const cur = Number(String(pl.networkHospitals || "").replace(/[^\d]/g, "")) || null;
      if (cur !== Number(metrics.network)) {
        add("networkHospitals", `${Number(metrics.network).toLocaleString("en-IN")}+`, blank(pl.networkHospitals) ? "fill" : "align", `${provider} (insurer)`);
      }
    }

    const match = matches[key] && byPath[matches[key]];
    if (!match) continue;
    for (const field of ["coPay", "roomRent", "prePost", "dayCare", "ayush"]) {
      const o = match.plan[field];
      const text = format[field](o);
      if (!text) continue;
      if (blank(pl[field])) add(field, text, "fill", match.path);
      else if (conflicts[field](pl[field], o)) add(field, text, "overwrite", match.path);
    }
  }
}

writeOut("proposals.json", { builtAt: new Date().toISOString(), catalogFetchedAt: snap.fetchedAt, dittoFetchedAt: ditto.fetchedAt, proposals });

const n = (f) => proposals.filter(f).length;
console.log(`proposals: ${proposals.length} across ${new Set(proposals.map((p) => p.insurerKey + "::" + p.planKey)).size} plans`);
console.log(`  fill ${n((p) => p.kind === "fill")} · align ${n((p) => p.kind === "align")} · overwrite ${n((p) => p.kind === "overwrite")}`);
console.log("  by field:", Object.fromEntries([...SAFE_FIELDS].map((f) => [f, n((p) => p.field === f)])));
const overwrites = proposals.filter((p) => p.kind === "overwrite");
if (overwrites.length) {
  console.log("\nReview these overwrites — add false positives to matches.json dropFields:");
  overwrites.forEach((p) => console.log(`  ${p.insurerKey}::${p.planKey}::${p.field}\n      "${p.oldValue}"  ->  "${p.newValue}"`));
}

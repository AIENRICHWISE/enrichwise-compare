#!/usr/bin/env node
/*
 * Step 1 — download structured plan data from joinditto.in.
 *
 * Each plan page (/health-insurance/<provider>/<plan>/) embeds Ditto's full
 * plan object in the Next.js RSC payload (self.__next_f.push chunks), plus the
 * insurer's metrics ("claimSettlement", "incurredClaims", "network"). Plan URLs
 * come from Ditto's sitemaps. robots.txt allows /health-insurance/* for
 * automated agents; requests are sequential and throttled.
 *
 *   node scripts/ditto-sync/fetch-ditto.js            # all mapped providers (~3 min)
 *   node scripts/ditto-sync/fetch-ditto.js --limit 3  # quick smoke test
 *
 * Writes out/ditto-plans.json.
 */
const { UA, PROVIDERS, writeOut } = require("./lib");

const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity; })();
const DELAY_MS = 400;
// Non-plan pages that share the /<provider>/<slug> shape.
const SKIP = new Set(["reviews", "claims", "network-hospitals", "renewal", "customer-care", "premium-calculator", "compare"]);
const WANTED = new Set([...Object.values(PROVIDERS), "max-bupa"]); // max-bupa: legacy Niva Bupa URLs, mostly 404

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  return { status: r.status, text: await r.text() };
}

const PUSH_RE = new RegExp('self\\.__next_f\\.push\\(\\[1,"((?:[^"\\\\]|\\\\.)*)"\\]\\)', "g");
function rscPayload(html) {
  return [...html.matchAll(PUSH_RE)]
    .map((m) => { try { return JSON.parse('"' + m[1] + '"'); } catch { return ""; } })
    .join("");
}

// Balanced-brace slice starting at `start`, respecting JSON strings.
function objectAt(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, k + 1);
  }
  return null;
}

// The page references the plan several times (cards, breadcrumbs, the full
// record). Keep the richest object whose `path` matches.
function extractPlan(payload, planPath) {
  const needle = '"path":"' + planPath + '"';
  let best = null;
  for (let from = 0; ;) {
    const i = payload.indexOf(needle, from);
    if (i < 0) break;
    from = i + 1;
    const start = payload.lastIndexOf('{"name":', i);
    if (start < 0) continue;
    const raw = objectAt(payload, start);
    if (!raw) continue;
    try {
      const o = JSON.parse(raw);
      if (o.path === planPath && (!best || Object.keys(o).length > Object.keys(best).length)) best = o;
    } catch { /* partial object — skip */ }
  }
  return best;
}

const PROVIDER_RE = /"claimSettlement":([\d.]+|null|"[^"]*"),"incurredClaims":("[^"]*"|null|[\d.]+),"network":("[^"]*"|null|[\d.]+)/;
function extractProviderMetrics(payload) {
  const m = payload.match(PROVIDER_RE);
  if (!m) return null;
  const v = (x) => (x === "null" ? null : x.replace(/^"|"$/g, ""));
  return { claimSettlement: v(m[1]), incurredClaims: v(m[2]), network: v(m[3]) };
}

(async () => {
  let locs = [];
  for (const sm of ["sitemap-0.xml", "sitemap-1.xml"]) {
    const { status, text } = await get("https://joinditto.in/" + sm);
    if (status !== 200) throw new Error(`${sm} returned HTTP ${status}`);
    locs = locs.concat([...text.matchAll(/<loc>https:\/\/joinditto\.in([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  const paths = [...new Set(locs.map((p) => p.replace(/\/$/, "")).filter((p) => {
    const seg = p.split("/");
    return seg.length === 4 && seg[1] === "health-insurance" && WANTED.has(seg[2]) && !SKIP.has(seg[3]);
  }))].slice(0, LIMIT);

  console.log(`plan pages to fetch: ${paths.length}`);
  const plans = [];
  let failed = 0;
  for (const [n, p] of paths.entries()) {
    const planPath = p.replace("/health-insurance", "");
    try {
      const { status, text } = await get("https://joinditto.in" + p + "/");
      if (status !== 200) { failed++; console.log(`  [${n + 1}] HTTP ${status} ${planPath}`); continue; }
      const payload = rscPayload(text);
      const plan = extractPlan(payload, planPath);
      if (!plan) { failed++; console.log(`  [${n + 1}] no plan object ${planPath}`); continue; }
      plans.push({ path: planPath, provider: planPath.split("/")[1], providerMetrics: extractProviderMetrics(payload), plan });
    } catch (e) {
      failed++; console.log(`  [${n + 1}] ERROR ${planPath}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  const file = writeOut("ditto-plans.json", { fetchedAt: new Date().toISOString(), plans });
  console.log(`done: ${plans.length} plans, ${failed} failed -> ${file}`);
})().catch((e) => { console.error(e.message); process.exit(1); });

#!/usr/bin/env node
/*
 * Local dev server for the comparison tool.
 *
 * Why not `npx serve`: the tool pulls its plan catalog from the Kavach backend
 * (GET /kavach/api/insurance-compare/catalog/). A plain static server has no
 * such route, so the fetch fails and the tool silently falls back to the
 * baked-in SEED_DB snapshot — you end up testing against stale plan data
 * without noticing. This server proxies /kavach/* to the live box, so what you
 * see locally matches production.
 *
 * The proxy needs the office network: tools.enrichwise.co.in is IP-allowlisted.
 * Off-network the proxy just fails and you get the offline fallback, same as
 * `npx serve`.
 *
 *   node dev-server.js                       # serve this repo
 *   node dev-server.js --port 4310
 *   node dev-server.js --root ../enrichwise-internal-tools/static
 *
 * Serves index.html at both / and /insurance-compare/ so local URLs can mirror
 * the production path.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const ROOT = path.resolve(arg("--root", __dirname));
const PORT = parseInt(arg("--port", process.env.PORT || "4310"), 10);
const UPSTREAM = arg("--upstream", "tools.enrichwise.co.in");
// Writes shot.png next to this script when the page POSTs a data URL to
// /__shot. Lets a headless/automated browser capture the rendered page when it
// cannot screenshot directly. Off unless --shots is passed.
const SHOTS = process.argv.includes("--shots");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2",
};

// GET/OPTIONS only. Blocking writes keeps local testing from filing real change
// proposals into the approval queue on the live box.
function proxy(req, res) {
  if (req.method !== "GET" && req.method !== "OPTIONS") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "blocked_locally", hint: "the dev proxy is read-only" }));
    console.log(`  BLOCKED ${req.method} ${req.url}`);
    return;
  }
  const up = https.request(
    { host: UPSTREAM, path: req.url, method: req.method,
      headers: { host: UPSTREAM, accept: req.headers.accept || "*/*", "accept-encoding": "identity" } },
    (r) => {
      console.log(`  proxy ${req.method} ${req.url} -> ${r.statusCode}`);
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  up.on("error", (e) => {
    console.log(`  proxy ${req.url} FAILED: ${e.message} (off the office network?)`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "upstream_unreachable", detail: e.message }));
  });
  up.end();
}

http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url.startsWith("/kavach/")) return proxy(req, res);

  if (url === "/__shot" && req.method === "POST") {
    if (!SHOTS) { res.writeHead(404).end("not found"); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const out = path.join(__dirname, "shot.png");
      fs.writeFileSync(out, Buffer.from(body.replace(/^data:image\/\w+;base64,/, ""), "base64"));
      console.log(`  wrote shot.png (${Math.round(fs.statSync(out).size / 1024)}KB)`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, file: out }));
    });
    return;
  }

  // /insurance-compare/... mirrors the production path onto the same files.
  let rel = decodeURIComponent(url).replace(/^\/insurance-compare\/?/, "/");
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  if (!path.resolve(file).startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      console.log(`  404 ${url}`);
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found: " + url);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
// Loopback only — this proxies to an internal host, so it should not be
// reachable from the rest of the office LAN.
}).listen(PORT, "127.0.0.1", () => {
  console.log("comparison tool · dev server");
  console.log(`  static : ${ROOT}`);
  console.log(`  proxy  : /kavach/* -> https://${UPSTREAM} (GET only)`);
  if (SHOTS) console.log("  shots  : POST /__shot -> shot.png");
  console.log(`  ready  : http://localhost:${PORT}/insurance-compare/`);
});

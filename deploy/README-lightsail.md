# How this is deployed at tools.enrichwise.co.in/insurance-compare/

**No extra AWS cost** — it's a static file served by the nginx already running on
the existing Lightsail box (the same box that runs the Kavach dashboard and the
other internal tools). No S3 / CloudFront / Route 53, no PM2 / Node process.

**Live (internal-only, office-IP allowlisted): https://tools.enrichwise.co.in/insurance-compare/**

## Important: the box is GitOps-managed — don't edit it directly

The Lightsail box regenerates `/var/www/enrichwise-tools/` and its nginx config
on every deploy, from the **`AIENRICHWISE/enrichwise-internal-tools`** repo
(`deploy/deploy.sh`, triggered by GitHub Actions on push to `main`). It runs
`rsync -av --delete static/ → /var/www/enrichwise-tools/`, so any file edited
directly on the server is **wiped on the next deploy**. (That's exactly what
happened on first attempt.)

So the tool is **vendored into that repo**, where it survives deploys:

- `static/insurance-compare/index.html` — a copy of this repo's `index.html`
- `static/index.html` — has the "Insurance Projects" section + card
- `deploy/nginx/enrichwise-tools.conf` — has the `location /insurance-compare/` block

## Updating the live tool

This repo (`enrichwise-compare`) is the canonical source / dev copy and also
publishes to GitHub Pages. The Lightsail copy is the vendored one above. To push
a change live on tools.enrichwise.co.in:

```bash
# 1. make + commit your change here, then copy the built file into the monorepo
cp index.html <path-to>/enrichwise-internal-tools/static/insurance-compare/index.html

# 2. commit + push the monorepo — GitHub Actions auto-deploys to Lightsail
cd <path-to>/enrichwise-internal-tools
git add static/insurance-compare/index.html
git commit -m "Update insurance comparison tool"
git push origin main
```

GitHub Actions (`.github/workflows/deploy.yml`) SSHes into the box and runs
`deploy.sh`, which rsyncs `static/` and validates+reloads nginx. Static file →
live in well under a minute, no build.

## Notes
- Data stays in the visitor's browser (localStorage); nothing is written on the
  server. No DB / persistence to manage.
- Tailwind, html2canvas and Google Fonts load from public CDNs at runtime.
- Access is limited to the office-IP allowlist in the nginx server block (same
  as Salesometer, FollowMeter, etc.).

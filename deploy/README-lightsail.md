# Deploy on the existing AWS Lightsail box (tools.enrichwise.co.in)

Serves the comparison tool as a **static file** under the same nginx server
block as the other Enrichwise internal tools. **No extra AWS cost** — it rides
on the Lightsail instance you already pay for, and needs no PM2 / Node process
(it's one HTML file). It's internal-only (inherits the server's office-IP
allowlist) and appears on the tools landing page under **Insurance Projects**.

**Live at: https://tools.enrichwise.co.in/insurance-compare/**

## Already deployed

This was applied on 2026-06-02 via SSH (`ssh kavach`):

1. **Files** cloned to `/var/www/enrichwise-tools/insurance-compare/`.
2. **nginx** — `deploy/nginx-insurance-compare.conf` inserted into
   `/etc/nginx/sites-available/enrichwise-tools` (before the `location ~ /\.`
   line), then `sudo nginx -t && sudo systemctl reload nginx`.
3. **Landing page** — an "Insurance Projects" section + card added to
   `/var/www/enrichwise-tools/index.html`.

Steps 2 & 3 are done by `deploy/apply_integration.py` (idempotent; backs up both
files with a timestamped `.bak` first). Re-running is safe — it skips anything
already present.

## Updating later (after pushing a change to GitHub)

```bash
ssh kavach 'cd /var/www/enrichwise-tools/insurance-compare && git pull'
```

Static files — the new version is live instantly (no build, no restart).

## Reverting

Each edit left a timestamped backup next to the original, e.g.:

```bash
# nginx
sudo cp /etc/nginx/sites-available/enrichwise-tools.bak.<ts> /etc/nginx/sites-available/enrichwise-tools
sudo nginx -t && sudo systemctl reload nginx
# landing page
sudo cp /var/www/enrichwise-tools/index.html.bak.<ts> /var/www/enrichwise-tools/index.html
```

## Notes
- All data stays in the visitor's browser (localStorage) — nothing is written on
  the server, so no DB / persistence / backups to manage.
- Tailwind, html2canvas and Google Fonts load from public CDNs at runtime; the
  box only serves the ~54 KB HTML.
- Access is restricted to the office IP allowlist in the nginx server block
  (same as Salesometer, FollowMeter, etc.).

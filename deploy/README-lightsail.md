# Deploy on the existing AWS Lightsail box (tools.enrichwise.co.in)

This serves the comparison tool as a **static file** under the same nginx server
block as the Kavach dashboard. **No extra AWS cost** — it rides on the Lightsail
instance you already pay for. No PM2 / Node process needed (it's one HTML file).

Final URL: **https://tools.enrichwise.co.in/kavach/compare/**

## First-time install (run once on the box, via your Lightsail SSH)

```bash
# 1. Clone the repo to the web root
sudo mkdir -p /var/www/enrichwise-compare
sudo chown -R "$USER":"$USER" /var/www/enrichwise-compare
git clone https://github.com/AIENRICHWISE/enrichwise-compare.git /var/www/enrichwise-compare

# 2. Add the nginx location block into the tools.enrichwise.co.in server block.
#    Open the site config (the one that already has /kavach/wa-tracking/):
sudo nano /etc/nginx/sites-available/enrichwise-tools.conf
#    → paste the contents of deploy/nginx-kavach-compare.conf INSIDE server { ... }

# 3. Validate + reload
sudo nginx -t && sudo systemctl reload nginx
```

Then open https://tools.enrichwise.co.in/kavach/compare/ — done.

## Updating later (after any change is pushed to GitHub)

```bash
cd /var/www/enrichwise-compare && git pull
```

That's it — static files, so the new version is live instantly (no build, no
restart). Compare to the Next.js dashboard which needs `deploy/update.sh`.

## Notes
- The tool stores all data in the visitor's browser (localStorage). Nothing is
  written on the server, so no DB / persistence / backups to worry about.
- Tailwind, html2canvas and Google Fonts load from public CDNs at runtime — the
  box only serves the 68 KB HTML. (If you ever want zero external calls, we can
  vendor those locally.)
- To change the path (e.g. `/kavach/insurance-compare/`), edit both `location`
  lines in `nginx-kavach-compare.conf` and the `alias` stays the same.

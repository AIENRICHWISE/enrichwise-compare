#!/usr/bin/env python3
# Idempotent integration of the Insurance Comparison tool into the
# tools.enrichwise.co.in nginx config + landing page. Backs up both files
# with a timestamped .bak before editing. Safe to re-run.
import time, sys, shutil

ts = time.strftime("%Y%m%d-%H%M%S")
NGINX = "/etc/nginx/sites-available/enrichwise-tools"
LANDING = "/var/www/enrichwise-tools/index.html"

nginx_block = "\n".join([
    "    # INSURANCE COMPARISON (static) - added " + ts,
    "    location /insurance-compare/ {",
    "        alias /var/www/enrichwise-tools/insurance-compare/;",
    "        try_files $uri $uri/ /insurance-compare/index.html;",
    "        expires 5m;",
    '        add_header Cache-Control "public, must-revalidate";',
    "    }",
    "",
    "",
])

landing_block = "\n".join([
    '        <div class="section">',
    '            <h2>Insurance Projects</h2>',
    '            <div class="grid">',
    '                <a class="tool" href="insurance-compare/">',
    '                    <div class="ico" style="background:#0a4d40;">',
    '                        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">',
    '                          <rect x="6" y="15" width="5" height="11" rx="1.5" fill="#fff"/>',
    '                          <rect x="13.5" y="9" width="5" height="17" rx="1.5" fill="#34d399"/>',
    '                          <rect x="21" y="5" width="5" height="21" rx="1.5" fill="#fff"/>',
    '                        </svg>',
    '                    </div>',
    '                    <div class="body">',
    '                        <div class="name">Insurance Comparison</div>',
    '                        <div class="desc">Side-by-side health-insurance plan comparison for clients — capture details, pick 2–5 plans, auto-fill add-ons, and export a branded PDF/JPG with a recommendation.</div>',
    '                    </div>',
    '                </a>',
    '            </div>',
    '        </div>',
    "",
    "",
])


def backup(p):
    b = p + ".bak." + ts
    shutil.copy2(p, b)
    return b


# --- nginx ---
with open(NGINX, encoding="utf-8") as f:
    ng = f.read()
if "/insurance-compare/" in ng:
    print("nginx: already integrated - skipping")
else:
    anchor = "    location ~ /\\. { deny all; }"
    if anchor not in ng:
        print("nginx: ANCHOR NOT FOUND - aborting"); sys.exit(2)
    b = backup(NGINX)
    ng = ng.replace(anchor, nginx_block + anchor, 1)
    with open(NGINX, "w", encoding="utf-8") as f:
        f.write(ng)
    print("nginx: location inserted (backup " + b + ")")

# --- landing page ---
with open(LANDING, encoding="utf-8") as f:
    lp = f.read()
if "Insurance Projects" in lp:
    print("landing: already integrated - skipping")
else:
    anchor2 = '        <div class="section">\n            <h2>Compliance &amp; Ops</h2>'
    if anchor2 not in lp:
        print("landing: ANCHOR NOT FOUND - aborting"); sys.exit(3)
    b = backup(LANDING)
    lp = lp.replace(anchor2, landing_block + anchor2, 1)
    with open(LANDING, "w", encoding="utf-8") as f:
        f.write(lp)
    print("landing: section inserted (backup " + b + ")")

print("OK")

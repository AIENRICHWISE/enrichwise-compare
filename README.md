# Enrichwise · Insurance Comparison Dashboard

A single-page health-insurance comparison tool for Enrichwise advisors. Capture client
details, pick 2–5 plans, toggle add-ons, and export a branded, client-facing comparison
(PDF / JPG). All data lives in the browser (`localStorage`) — **no backend, no database**.

- **Stack:** one static `index.html` — Tailwind (CDN), html2canvas (CDN), Google Fonts. Vanilla JS state machine, no framework, no build step.
- **Storage:** the editable policy catalog persists per-browser under the `ew_db` key. Edit it via **⚙︎ Manage policy data** in the header.

---

## Run locally

Just open the file — double-click `index.html` in any browser. That's it.

Or serve it (so the path looks like a real site):

```bash
npm run dev      # → http://localhost:3000  (uses npx serve, no install needed)
```

---

## Deploy (go live)

Because it's pure static HTML, any static host works. Pick one:

### Option A — Vercel (recommended, free)
1. Push this folder to a GitHub repo (see below).
2. Go to <https://vercel.com/new>, import the repo.
3. Framework preset: **Other**. Build command: **(leave empty)**. Output dir: **`.`**
4. Deploy → you get a `https://<name>.vercel.app` URL. `vercel.json` is already included.

Or from this folder with the CLI:
```bash
npx vercel        # first run links/creates the project
npx vercel --prod # publishes to the live URL
```

### Option B — Netlify (drag-and-drop, no Git needed)
- Go to <https://app.netlify.com/drop> and drag this whole folder onto the page. Done.
- Or connect the GitHub repo; `netlify.toml` tells it to publish as-is with no build.

### Option C — GitHub Pages
- Push to GitHub → repo **Settings → Pages** → deploy from `main` / root. Live at `https://<user>.github.io/<repo>/`.

---

## Push to GitHub

```bash
git init
git add -A
git commit -m "Enrichwise insurance comparison dashboard"
git branch -M main
git remote add origin https://github.com/<you>/enrichwise-compare.git
git push -u origin main
```

---

## Editing policy data

The whole catalog (insurers, plans, features, add-ons) is one JSON object. Open the app →
**⚙︎ Manage policy data** → edit the JSON → **Save & apply**. Changes persist in *your*
browser. To ship updated defaults to everyone, paste the JSON into the `SEED_DB` object near
the top of the `<script>` in `index.html` and redeploy.

> **Data provenance:** the structural plan facts (room rent, co-pay, pre/post, restore, NCB,
> AYUSH, day-care, instant cover, add-ons) are extracted from each insurer's **official policy
> wording**. Two fields are *not* in policy wordings and are shown as `—` where unconfirmed:
> **claim-settlement ratio** and **network-hospital count** — source these from IRDAI / insurer
> disclosures. Always re-verify against the latest wordings before sharing with a client.

---

## Notes / upgrade paths (later)

- **Tailwind CDN** is used for zero-build simplicity. For production polish you can swap to a
  Tailwind build to drop the CDN console warning and avoid a flash of unstyled content.
- **Shared data** (all advisors see the same catalog / saved comparisons) would need a small
  backend or hosted DB — the localStorage layer is isolated behind `safeGet`/`safeSet`, so it's
  a contained swap when you're ready.

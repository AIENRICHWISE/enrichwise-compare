# Ditto → Kavach catalog sync

Pulls verified plan facts from [joinditto.in](https://joinditto.in/health-insurance/compare-plans/)
and queues them as change proposals in Kavach. **Nothing goes live until an admin approves
them** at `/kavach/settings/insurance-compare` (approve-all works).

Needs Node 18+ and the office network (the Kavach API is IP-allowlisted).

## Run

```bash
npm run ditto:fetch     # 1. download Ditto plan data (~3 min, throttled) → out/ditto-plans.json
npm run ditto:catalog   # 2. snapshot the live catalog → out/catalog.json
npm run ditto:check     # 3. validate matches.json; list unmapped plans with candidates
npm run ditto:build     # 4. diff → out/proposals.json; prints every overwrite for review
npm run ditto:submit    # 5. dry run — shows exactly what would be queued
npm run ditto:submit -- --submit   # queue for approval, then commit submitted.json
```

Run 2 → 5 in one sitting: submit refuses a catalog snapshot older than 6 hours.

## What gets proposed

| Field | Scope | Rule |
|---|---|---|
| Claim settlement ratio | every plan of a mapped insurer | aligned to Ditto's insurer figure (3-year average) |
| Network hospitals | every plan of a mapped insurer | aligned to Ditto's insurer figure |
| Co-pay, room rent, pre/post, day care, AYUSH | plans in `matches.json` only | blanks filled; existing values overwritten **only** on a detected conflict |
| Discontinued | plans in `matches.json` only | marked when Ditto lists the plan as discontinued — the tool then badges it, never auto-recommends it, and warns the advisor if picked |

Deliberately **not** proposed:

- **No-claim bonus and restore benefit.** Approval writes the value as a plain string, but the
  growth chart and scoring read `ncbModel` / `restore` as objects — a string would break them.
  Edit those in `/kavach/insurance-db`. The same applies to `uniqueFeatures`, `sumInsured`,
  `addOns` and `instantCover`; `lib.js` `SAFE_FIELDS` enforces this.
- **Plans without a reviewed match.** Ditto doesn't carry every product (no Optima Select,
  ReAssure 3.0, Asha Kiran…) and name matching is unreliable across variants, so unmatched
  plans only get the insurer-level fields.
- **Kotak** — not on Ditto.

## Files

| File | Committed | Purpose |
|---|---|---|
| `matches.json` | yes | reviewed catalog-plan → Ditto-page map, plus `dropFields` for reviewed false-positive overwrites |
| `submitted.json` | yes | ledger of everything sent to the approval queue |
| `out/` | no | fetched data and built proposals |

## Maintaining it

**Adding a match:** run `ditto:check`, confirm the candidate is the *same product* (fuzzy scoring
happily pairs "Optima Select" with "Optima Secure"), add `"insurer::planKey": "/provider/slug"` to
`matches.json`. Ditto slugs are irregular — e.g. `/care/care-freedom-plan`,
`/aditya-birla/Activ-assured-diamond`.

**A false-positive overwrite:** add `insurer::planKey::field` to `dropFields.keys`.

**Why the ledger exists:** there is no public endpoint for *pending* proposals. Rebuilding while
a batch awaits approval regenerates the same changes, and submitting would double-queue them.
Submit skips any field whose last submitted value doesn't yet match the live catalog. If an admin
*rejected* a change, that field stays skipped until you resend it — target it with `--only`, because
`--resubmit` on its own also resends everything still pending:

```bash
npm run ditto:submit -- --resubmit --only niva::re20::claimSettlementRatio --submit
```

## Gotchas

- **CSR is kept as a bare percentage** (`"89%"`), compared by exact string. Until Sept 2026 the
  tool's scorer stripped every non-digit, so `"89% (3-year average)"` scored as 893 and Tata AIG
  was auto-recommended over everything. The scorer now reads the first number, but keeping values
  bare means an older cached copy of the tool can't be tripped either.
- **Provenance goes in `submittedBy` / `clientName`.** The admin UI does not render `note`.
- **How the data is reached:** each plan page embeds Ditto's structured plan object in the
  Next.js RSC payload (`self.__next_f.push` chunks), with insurer metrics as
  `"claimSettlement":89,"incurredClaims":"67%","network":"14000"`. If Ditto changes its page
  build, `fetch-ditto.js` is the only file to adjust. robots.txt allows `/health-insurance/*`.
- **`discontinued` is one-way.** Approval can't write an empty value, so if Ditto ever lists a plan as
  back on sale, clear the note by hand in `/kavach/insurance-db`. Don't *archive* discontinued plans
  instead — archived plans vanish from the tool, and portability cases need to compare a client's
  existing (often discontinued) policy.

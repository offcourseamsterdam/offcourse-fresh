# Google Ads Campaign Management (create + control via the codebase)

**Status:** working, verified live against the real Google Ads API (dry-run).
**Companion to:** [google-ads-conversion-tracking.md](google-ads-conversion-tracking.md) (the *reporting* side). This doc is the *management* side — creating and controlling campaigns, ad groups, keywords, and ads from our own code.

---

## What was built

A library + CLI that lets us **create and manage Google Ads Search campaigns directly from the codebase**, reusing the OAuth credentials already configured for conversion tracking. Today it's driven through a command-line tool (Claude runs commands on Beer's behalf); the same library is designed to be imported later by an admin dashboard with zero changes.

Capabilities:
- **Create** a complete Search campaign atomically (budget → campaign → geo/language targeting → ad group → keywords → negatives → responsive search ad) in a single all-or-nothing request.
- **Dry-run by default** — every create runs in Google's `validateOnly` mode first (validates everything, creates nothing, costs nothing).
- **Read** — list accounts, list campaigns, per-campaign performance (cost, conversions, ROAS), keyword stats, and the search-terms report (for finding negatives).
- **Control** — pause/enable a campaign, change its daily budget, add keywords, add negative keywords.

---

## Key files

| File | Description |
|---|---|
| `src/lib/google-ads/campaign-client.ts` | Generic Google Ads REST caller (search + mutate + listAccessibleCustomers). Reuses `auth.ts`. Kept **separate** from `client.ts` (the conversion-upload transport) so the money path is untouched. Includes `extractAdsError` which surfaces the **field path** of a rejected operation. |
| `src/lib/google-ads/campaigns.ts` | The heart: pure payload builders (`buildSearchCampaignOps`) + orchestrators (`createSearchCampaign`, `setCampaignStatus`, `updateCampaignBudget`, `addKeywords`, `addNegativeKeywords`) + client-side validators (`validateRsa`, `validateSpec`). |
| `src/lib/google-ads/reporting.ts` | GAQL read queries → typed rows with derived metrics (CTR, cost/conversion, ROAS). |
| `src/lib/google-ads/geo-constants.ts` | Country → geoTargetConstant and language → languageConstant maps for the markets we target. |
| `src/lib/google-ads/campaigns.test.ts` | 23 unit tests for the builders/validators (no network). |
| `scripts/google-ads/gads.ts` | The CLI ("talking interface"). Loads `.env.local`, dispatches commands, prints tables. |
| `scripts/google-ads/campaigns/private-cruise.json` | The Private Canal Cruise campaign defined as **reviewable data** (edit and re-run). |
| `package.json` | Added `npm run gads -- <command>`. |

---

## Architecture decisions (the non-obvious ones)

### 1. Atomic creation with temporary resource names
A campaign is many linked objects (the campaign points at a budget; keywords point at an ad group). We send them all in **one** `googleAds:mutate` request using negative temporary ids (`campaignBudgets/-1`, `campaigns/-2`, `adGroups/-3`) that later operations reference. Google resolves them in order and commits **all or nothing**. Two payoffs:
- **No orphans.** If step 6 fails, the budget from step 1 is never persisted.
- **True dry-run.** `validateOnly: true` validates the entire graph at once. (Sequential one-call-per-object creation *can't* be dry-run, because step 2 would reference a budget that step 1 didn't actually create.)

### 2. Separate transport from the money path
`campaign-client.ts` is deliberately a sibling of, not a modification to, `client.ts`. The conversion-upload code is proven and load-bearing (it reports real revenue to Google). Campaign management never imports it and never touches it, so there's no way a campaign change can break conversion reporting. They share only `auth.ts` (the OAuth token).

### 3. Field-path error extraction
Google's validation errors are famously opaque (`"The required field was not present."`). `extractAdsError` digs `error.details[].errors[].location.fieldPathElements` out of the response and appends it, turning that into `...at mutate_operations[1].campaign_operation.create.contains_eu_political_advertising`. This is the same class of "silent unknown error" the conversion-tracking handoff (§7.2) warned about — here we make the API *tell us* what's wrong.

### 4. Pure builders, testable without the network
`buildSearchCampaignOps(spec, customerId, validateOnly)` does no I/O — it returns the request payload. All 23 tests assert payload shape (correct micros, PAUSED default, partners/display off, one criterion per location, etc.) with zero API calls, per the project's "test the logic, not the UI/network" rule.

### 5. Safe defaults
- Campaigns are created **PAUSED** — nothing spends until Beer reviews and enables.
- Search partners + Display network are **off** (tighter, higher-intent traffic).
- Money is entered in **euros** everywhere and converted to Google's **micros** in one place (`eurosToMicros`).

---

## How it works (data flow)

```
Beer asks → Claude runs:  npx tsx scripts/google-ads/gads.ts <command>
   │
   ├─ gads.ts loads .env.local → process.env
   ├─ imports the library (campaigns.ts / reporting.ts)
   │
   ├─ create:  buildSearchCampaignOps(spec) → googleAds:mutate (validateOnly unless --live)
   ├─ read:    GAQL via googleAds:search → typed rows → printed table
   └─ control: campaigns:mutate / campaignBudgets:mutate / adGroupCriteria:mutate
        │
        └─ campaign-client.googleAdsCall() → getAccessToken() (refresh token)
                                          → POST googleads.googleapis.com/v20/...
```

The **campaign spec** (`private-cruise.json`) is the single source of truth for what gets created — version-controlled, diff-able, re-runnable.

---

## Common commands

```bash
npm run gads -- accounts                       # auth sanity check
npm run gads -- campaigns                       # list campaigns + budgets
npm run gads -- create                          # DRY RUN the private-cruise campaign
npm run gads -- create --live                   # actually create it (starts PAUSED)
npm run gads -- enable --campaign <id>          # turn it on
npm run gads -- performance --days 30           # cost / conversions / ROAS
npm run gads -- search-terms --campaign <id>    # find negative-keyword candidates
npm run gads -- add-negatives --campaign <id> "houseboat" "ferry"
npm run gads -- budget --campaign <id> --eur 40 # change daily budget
```

---

## How to extend

- **New campaign** → copy `private-cruise.json`, edit, run `create --config scripts/google-ads/campaigns/<new>.json`.
- **New market/language** → add the id to `geo-constants.ts` (from Google's geo/language tables).
- **New operation** (e.g. ad-schedule, audience, bid adjustment) → add a builder + orchestrator in `campaigns.ts` following the existing pattern, then a CLI case in `gads.ts`.
- **Admin dashboard** → import the same library functions from API routes (see "Admin interface ideas" in the implementation notes / chat). The library is UI-agnostic; nothing in it assumes a CLI.
- **API version bump** → set `GOOGLE_ADS_API_VERSION` (Google sunsets ~3 versions/year).

---

## Dependencies

- **Depends on:** the existing Google Ads OAuth (`auth.ts`) and env vars (`GOOGLE_ADS_*`), `tsx` (dev), and a Google Ads **manager (MCC)** structure where the advertiser account is linked under the manager (`login-customer-id`).
- **Depended on by:** nothing yet. Future: the admin Google Ads dashboard.
- **Required Google-side field:** `containsEuPoliticalAdvertising` (mandatory on every campaign since the 2025 EU political-ads regulation) — set to `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`.

---

## Verification done

- 23 builder/validator unit tests + full suite (454 tests) green.
- Lint + typecheck clean.
- **Live API:** `accounts` and `campaigns` read successfully; `create` **dry-run passes** against the real account (budget, EU flag, 4 locations, 2 languages, 17 negatives, 12 phrase keywords, RSA with 15 headlines + 4 descriptions). No campaign created yet — awaiting Beer's go-ahead + a confirmed live landing-page URL.

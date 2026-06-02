# AI Referrals Tracking (are AI assistants citing us?)

**Status:** built + tested; already detecting real traffic. Lives in the admin **Campaigns** page.

## What it is

The only first-party signal we have for **AI citations** — when ChatGPT / Perplexity / Gemini / Copilot / Claude etc. mention Off Course and a user clicks through. The Google Ads API knows nothing about this; the signal is the **referrer** the browser sends (`chatgpt.com`, `perplexity.ai`, …). We classify referrered sessions, group by engine, and attribute bookings.

> On first run against live data it already found **1 real ChatGPT session** — one that was invisible in the top-25 referrers list because it's a single hit. The tracker scans *all* referrers, so it surfaces AI traffic the channel reports miss.

## Key files

| File | Responsibility |
|---|---|
| `src/lib/tracking/ai-referrers.ts` | `classifyAiReferrer(url)` → engine, `AI_ENGINES` table, `aggregateAiReferrals(sessions, bookings)` (pure). |
| `src/lib/tracking/ai-referrers.test.ts` | 9 tests (classification + aggregation + attribution). |
| `src/app/api/admin/tracking/ai-referrals/route.ts` | GET — sessions in range → classify → bookings via `session_id`. Dev `?demo=1`. |
| `src/app/[locale]/admin/campaigns/AiReferralsSection.tsx` | The UI section (per-engine visits/visitors/bookings/revenue + empty state). |
| `src/app/[locale]/admin/campaigns/page.tsx` | Renders the section under the header. |

## How it works / decisions

- **Classifier is the source of truth.** The route fetches all referrered sessions in the date range (~500/month — tiny) and classifies in JS, rather than a fragile SQL `ilike` wildcard filter. Correctness over micro-optimization at this volume.
- **Attribution mirrors the app.** A booking belongs to the session it was made in (`bookings.session_id → analytics_sessions.id`), revenue = `stripe_amount` (cents), confirmed only, anonymous visitor ids (`anon_*`) excluded from unique-visitor counts — identical to the existing channel metrics.
- **Known limitation, surfaced in the UI:** Google's AI Overviews appear under the normal `google.com` referrer, so they can't be separated from organic Google here.

## How to extend

Add an engine → one entry in `AI_ENGINES` (`{ key, label, hosts }`); the SQL host list, classifier, and aggregation all derive from it. Add a test case.

## Dependencies

Reads `analytics_sessions` (referrer, visitor_id, started_at) + `bookings` (session_id, stripe_amount, status). Uses `requireAdmin`, `apiOk`, `useAdminFetch`.

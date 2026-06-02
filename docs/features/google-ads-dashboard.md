# Google Ads Admin Dashboard (monitor & maintain)

**Status:** built, verified visually + full test suite green. Read-and-maintain only — campaign *creation* stays in the approval-gated chat/CLI flow.
**Builds on:** [google-ads-campaign-management.md](google-ads-campaign-management.md) (the library) and [google-ads-conversion-tracking.md](google-ads-conversion-tracking.md) (the net-value reporting that makes "true profit" possible).

---

## What was built

A simple, focused, visual admin surface at **`/admin/google-ads`** — the antidote to Google's overwhelming dashboard, aimed at a Google Ads newbie. It answers one question per glance: *is this making money?*

- **Three hero cards** — Profit (€, net revenue − ad spend), Bookings from ads, ROAS.
- **Visual funnel** — Impressions → Clicks → Bookings with drop-off %, so you see *where* it breaks.
- **Campaign cards** — each with a plain-English verdict (🟢 Profitable / 🟡 Warming up / 🔴 Spending no bookings / Losing / Paused), spend, **CPC** (avg cost-per-click), bookings, profit (green/red), ROAS, an inline budget editor, a pause/enable toggle, a **marketing-campaign link**, and a **one-click negatives** panel (block junk searches).
- **Slack guardrail + auto-pause** — a daily cron that pings Slack if a campaign overspends a cap or burns money with zero bookings, and **auto-pauses** any campaign that crosses the hard-bleed line (real spend, zero bookings — default €200).
- **Marketing-campaign link** — each Google Ads campaign connects to a **marketing campaign** (a `campaigns` row, i.e. the `/t/<slug>` tracking link its ad points at). The **listing is derived** from that marketing campaign (`campaigns.listing_id`) and shown read-only — you change the campaign, not the listing. The CLI records this link automatically from the ad's `/t/` Final URL.

### Why "true profit" works here (the differentiator)
Because the Stripe webhook already reports the **net ex-VAT** booking value to Google, Google's own campaign report returns net-revenue-per-campaign in `conversions_value`. So **profit = conversions_value − cost** — both already in the performance report. No extra join, no inflated gross. Most competitors feed Google the gross total (or nothing), so they literally can't see this.

---

## Key files

**Pure logic (fully unit-tested)** — `src/lib/google-ads/`
| File | Responsibility |
|---|---|
| `dashboard.ts` | `campaignProfit`, `verdict`, `sumPerformance`, `heroStats`, `funnelSteps`, `mergeCampaign`, `buildDashboardPayload` — every transform the dashboard shows. |
| `guardrail.ts` | `evaluateGuardrail` (pure rules) + `formatAlerts` (Slack text) + `runGuardrail` (fetch + post). |
| `listings.ts` | `listingUrl` (pure) + `getCampaignMarketingMap` / `listMarketingCampaigns` / `setCampaignMarketing(BySlug)` / `removeCampaignMarketing` (Supabase, client injected). |
| `dashboard.fixtures.ts` | Dev-only sample data for the `?demo=1` seam. |
| `*.test.ts` | dashboard (17), guardrail (8), listings (3). |

**API routes** — `src/app/api/admin/google-ads/`
| Route | Method | Purpose |
|---|---|---|
| `route.ts` | GET | The whole dashboard payload (parallel fetch → `buildDashboardPayload`). `?demo=1` (dev) + `?days=`. |
| `campaign/route.ts` | POST | pause / enable / change budget |
| `negatives/route.ts` | POST | add campaign negative keywords |
| `link/route.ts` | POST | connect/disconnect a Google Ads campaign ↔ marketing campaign (listing derived) |
| `search-terms/route.ts` | GET | real queries (powers the negatives panel) |

**UI** — `src/app/[locale]/admin/google-ads/`
| File | Responsibility |
|---|---|
| `page.tsx` | Hero cards (reuses `KPICard`), funnel (reuses `FunnelChart`), day toggle, campaign list. |
| `CampaignCard.tsx` | Verdict badge, pause/enable, inline budget, listing dropdown, negatives expander. |
| `NegativesPanel.tsx` | Search-terms list with one-click Block buttons. |

**Cron / wiring / data**
| File | Responsibility |
|---|---|
| `src/app/api/cron/ads-guardrail/route.ts` + `vercel.json` | Daily guardrail → Slack (`requireCronSecret`). |
| `src/app/[locale]/admin/layout.tsx` | Nav entry under "Performance". |
| `supabase/migrations/054_google_ads_campaign_listings.sql` | Campaign bridge table (service-role RLS). |
| `supabase/migrations/055_google_ads_campaign_marketing_link.sql` | Adds `marketing_campaign_id`; listing becomes derived. |
| `scripts/google-ads/gads.ts` | `create --listing <slug>` auto-URL + records the **marketing-campaign** link from the ad's `/t/` slug. |

---

## Architecture decisions

1. **Reuse over rebuild.** Hero cards use the existing `KPICard`; the funnel uses the existing `FunnelChart` (its `{event,label,count,drop_off_rate}` shape is exactly what `funnelSteps` emits); data fetching uses `useAdminFetch` (SWR), which already expects the `{ok,data}` envelope `apiOk` returns.
2. **One pure pipeline.** `buildDashboardPayload(campaigns, perf, listingMap)` assembles hero + funnel + merged rows with zero I/O. The real route and the `?demo=1` fixtures both run through it, so the demo exercises real logic and the whole thing is unit-testable.
3. **No creation in the UI.** Per the owner's call, campaigns are created via the chat/CLI two-step (dry-run → live, starts paused). The dashboard only reads and does *safe-by-default* maintenance; spend-increasing actions (enable, raise budget) require a confirm dialog.
4. **Profit from Google's own report.** Avoids a fragile join against our `google_ads_conversions` table — Google already has the net value we sent it.
5. **Bridge as a tiny table.** Campaigns live in Google, marketing campaigns + listings in Supabase; `google_ads_campaign_listings` is the one-row-per-campaign bridge. It stores `marketing_campaign_id` (the source of truth) and caches the derived `listing_id`/`listing_slug` for per-listing grouping and slug→URL derivation. The listing always *follows* the marketing campaign — you can't set it independently (migration 055).
6. **Dev demo seam.** `?demo=1` (gated to non-production) lets the visuals be reviewed before any real campaign exists — how this feature was visually verified.

---

## How to extend

- **New metric/verdict rule** → edit the pure function in `dashboard.ts` + its test.
- **New guardrail rule** → add to `evaluateGuardrail` + test; it flows to Slack automatically.
- **New card action** → add an API route (wrap a `campaigns.ts` function) + a button in `CampaignCard.tsx`.
- **Tune the guardrail cap** → `DEFAULT_GUARDRAIL_CONFIG` in `guardrail.ts` (or pass config in the cron route).

## Dependencies

- **Depends on:** the Google Ads library (`reporting.ts`, `campaigns.ts`), `KPICard`/`FunnelChart`/`useAdminFetch`, `requireAdmin`/`requireCronSecret`/`apiOk`, `postSlackText`, and the `google_ads_campaign_listings` table.
- **Depended on by:** the admin nav. The Slack guardrail depends on `SLACK_WEBHOOK_URL` (no-ops without it).

## Verification

- **Unit:** 28 new tests (dashboard 17, guardrail 8, listings 3); full suite **512 green**; lint + typecheck clean. The admin-route auth-contract test confirms all 5 new routes carry `requireAdmin`.
- **Backend:** `GET /api/admin/google-ads?demo=1` returns correct hero (€1,477 profit), funnel, and verdicts through the real pipeline.
- **Visual (preview, `?demo=1`):** populated dashboard (3 hero cards + funnel drop-offs + verdict-coded campaign cards), empty state (clean zeros + "create by talking to Claude"), and mobile 375px (cards stack). No real campaign was created.

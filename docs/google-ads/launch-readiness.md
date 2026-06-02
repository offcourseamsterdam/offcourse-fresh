# Off Course — Private Cruise Campaign: Launch Readiness

*The single reference to finish and go live. Compiled June 2026. Keyword traffic from Google Keyword Planner (Off Course Canal Cruises account), English, targeting Netherlands + UK + US + Germany, trailing 12 months.*

---

## Status: validated blueprint, nothing live

The campaign is built as a config file and **dry-run validated against the live Google Ads API** — Google confirmed every keyword, negative, ad, and extension is valid. **Nothing has been created or spent.** One command turns it into a real campaign that starts **paused** for your review.

- **Config file:** `scripts/google-ads/campaigns/private-cruise-en.json`
- **Go-live command:**
  ```
  npm run gads -- create --config scripts/google-ads/campaigns/private-cruise-en.json --live --listing off-beaten-path-hidden-gems-canal-cruise
  ```

---

## Keyword traffic (real Google Keyword Planner data)

**Bid = top-of-page bid range. Your actual CPC is usually nearer the low end. ✅ = confirmed in Keyword Planner; ~ = estimated from secondary data (low-volume long-tail).**

### Exact-match core terms (the volume drivers)
| Keyword | Searches/mo | Competition | Top-of-page bid |
|---|---|---|---|
| private boat tour amsterdam | **1,900** ✅ | High | €1.27 – €4.15 |
| private canal cruise amsterdam | **1,900** ✅ | High | €1.30 – €4.29 |
| private canal tour amsterdam | ~1,900 | High | ~€1.30 – €4.10 |
| private boat amsterdam | **390** ✅ | High | €1.33 – €3.66 |
| private cruise amsterdam | ~500 | High | — |

### Phrase-match expansion terms
| Keyword | Searches/mo | Competition | Top-of-page bid |
|---|---|---|---|
| private boat hire amsterdam | ~170 | High | ~€1.60 – €4.57 |
| amsterdam private boat tour | ~300 | High | — |
| private boat trip amsterdam | ~150 | Medium | — |
| private canal boat amsterdam | ~120 | Medium | — |
| private canal boat tour amsterdam | ~110 | High | — |
| private boat tour for 2 amsterdam | ~90 | Medium | — |
| private boat amsterdam with drinks | ~70 | Medium | — |
| small private boat tour amsterdam | ~70 | Medium | — |

**Private-intent addressable demand ≈ 7,000+ searches/month** across these terms in the four target countries. At €25/day you'll buy ~300 clicks/month, so **search volume is not the constraint — your budget is.** That means clean room to scale later.

### Seasonal signal 🔥
The 3-month trend is **rising sharply** — "boat tour amsterdam" +49%, "canal cruise amsterdam" +22%, "private boat tour amsterdam" +14%. Demand is climbing into summer. **You're launching at the right time.**

### Deliberately excluded (future SHARED campaign)
These are huge but **general/shared intent** — they'd waste the private budget, but they're a major future opportunity:
| Keyword | Searches/mo | Competition | Bid |
|---|---|---|---|
| canal cruise amsterdam | **18,100** | Medium | €0.83 – €2.85 |
| boat tour amsterdam | **12,100** | High | €0.99 – €3.00 |
| amsterdam canal tour | 5,400 | High | €1.03 – €3.38 |
| boat cruise amsterdam | 2,900 | High | €0.84 – €2.96 |

---

## Campaign settings (what's in the config)

| Setting | Value | Why |
|---|---|---|
| Type | Standard Search | Highest intent, controllable; AI Max **off** until 30 conversions |
| Bidding | Maximize Conversions (no target CPA) | No conversion history yet; budget is the cap |
| Match types | 19 keywords, all PHRASE | You chose phrase across the board for broader reach |
| Negatives | 104 | Block self-drive/rental, cheap/free, jobs, for-sale, info, adjacent products, competitors, other cities |
| Locations | Netherlands, UK, US, Germany | Tourist source markets + local expats |
| Language | English | Clean experiment; Dutch is a separate future campaign |
| Daily budget | €25/day | Research floor for learning signal; downside capped ~€760/mo |
| Ad | 15 headlines, 4 descriptions | Brand voice — "friend with a boat," no pretension; "Private Boat From €310" |
| Extensions | 5 sitelinks · 6 callouts · 1 structured snippet | Parity with competitors (all of them run extensions); incl. "Book Last Minute" |
| Landing page | /cruises/off-beaten-path-hidden-gems-canal-cruise | Published private listing, converts warm traffic at 3.6% |

---

## Expected outcome (real data + your margins)

At **€25/day (~€760/mo)**, ~€2.50 blended CPC → **~300 clicks/month.**

| If paid converts at… | Bookings/mo | True net profit/mo* |
|---|---|---|
| 3.6% (your current rate) | ~11 | **~€2,300** |
| 2.5% (conservative paid) | ~7.6 | **~€1,400** |
| 2.0% (pessimistic) | ~6 | **~€930** |

\*After skipper (€85), drinks cost, *and* ad spend — using €281.74 contribution/booking. Profitable in every scenario; break-even CPC is ~€10 vs a €2–4 reality.

---

## ✅ Go-live checklist — everything needed to finish

**Already done**
- [x] Campaign config built + **dry-run validated** against the live API
- [x] Ad extensions built into the tooling + config
- [x] Conversion tracking live (server-side offline import, net ex-VAT value)
- [x] Competitor recon + keyword research complete

**Before you flip it on (your checks)**
- [ ] **Landing page loads** at `offcourseamsterdam.com/cruises/off-beaten-path-hidden-gems-canal-cruise` — Google disapproves ads whose page 404s. Open it and confirm.
- [ ] **Billing active** on the Off Course Canal Cruises account — a campaign cannot serve without a valid payment method. Check Billing in Google Ads.
- [ ] **Conversion tracking confirmed firing** — do a test booking (or check recent `google_ads_conversions` rows) so Smart Bidding has signal from day one.

**Launch sequence**
- [ ] Run the `create --live` command above → creates the campaign **PAUSED**, linked to the listing, URL auto-set
- [ ] Review in the Google Ads UI: ad preview, extensions showing, keywords, geo + language, €25 budget
- [ ] **Enable** the campaign yourself (you, not me — your call to start spending)
- [ ] Write the **2-week diagnostic checkpoint** on your calendar (below)

**The 2-week checkpoint (decide the rule now)**
- Clicks coming, **0 bookings** + tracking confirmed → landing-page/offer problem; pause & fix, don't keep feeding
- **Barely any clicks** → bids too low / too narrow; small tweak
- **1–3+ bookings** → it works; scale budget, then turn on AI Max

---

## Open decisions for you
1. **Budget: €25/day?** Your margins (€280 contribution/booking) justify more, but €25 is the safe "prove paid converts" start. Could front-load €30 in week one for faster signal.
2. **Bidding: Maximize Conversions** (optimizes to bookings) vs **Maximize Clicks + max CPC** (cheaper pure-validation). Config uses Maximize Conversions.

## Non-blocking follow-ups (after launch)
- **API token access** — application is filled and waiting on your submit; once approved, `gads research` pulls keyword data straight to the terminal.
- **Add drinks margin to conversion value** — currently Smart Bidding sees the base booking only, so it slightly under-values clicks by ~€30/booking.
- **Auction Insights** — once live, check weekly to see your position vs Bow's Journeys & Private Canal Cruises (your closest rivals).
- **Performance Max (Google Maps)** — biggest untapped surface; needs assets + conversion history. Phase 2.
- **Dutch + occasions campaigns** — Dutch company-outings, and occasion ads (proposals/birthdays) which competitors prove are in demand.

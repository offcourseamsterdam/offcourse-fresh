# Special-event cruise listings (Pride Amsterdam 2026)

## What was built

A distinct presentation for **fixed-date special-event** cruise listings — a private whole-boat charter that only runs on one scheduled day (the first is Pride Amsterdam 2026, Aug 1). These sit on the normal [virtual product layer](../implementation-plan.md): one FareHarbor item backs a `cruise_listings` row like any other, but the detail page detects the event by slug and adapts.

Event pages differ from a standard listing in six ways:

1. **Single-day booking.** The date picker collapses to just the event day (no 14-day scroller / calendar), and the booking widget defaults straight to that date instead of "today" (which would always read as fully-booked and force an extra click).
2. **Only the offered boat(s).** A boat the listing doesn't include is omitted entirely, not shown as permanently "sold out".
3. **Open bar, not upsells.** The pay-per-item Food/Drinks grid is replaced with an "open bar included" card, since drinks are in the price.
4. **Whole-boat price framing.** The booking header leads with the full boat price (e.g. **€1,560**), then a per-person / per-person-per-hour breakdown — no "starting from".
5. **Real meeting point.** "Where we meet" embeds a map at the listing's own coordinates instead of the default company dock.
6. **Rainbow theming + easter egg** (Pride-specific flavour): rainbow gradient headings, boat card, and selected time slot, plus a rainbow cursor-trail with a click/tap splash.

Several underlying fixes were surfaced by this work and apply to **all** listings — see below.

## Key files

| File | Role |
|------|------|
| `src/app/[locale]/(public)/cruises/[slug]/page.tsx` | The detection point. A `SPECIAL_EVENTS` config map (`slug → { date, hours, mapCoords }`) drives everything: `isSpecialEvent`, the `fixedDate`, `offeredBoatIds`, `mapCoords`, the whole-boat price math, and the redesigned `renderStartCruisingHeader`. |
| `src/components/cruise/RainbowCursorTrail.tsx` | **New.** `'use client'` canvas overlay — a hue-walking ribbon that trails the cursor plus a particle-burst on `pointerdown` (works for mouse + touch). Respects `prefers-reduced-motion`; ribbon needs a fine pointer, splash does not. Gated to the Pride slug in the page. |
| `src/components/cruise/CruiseContentSections.tsx` | Rainbow heading helper; Open-bar card replaces `ExtrasGrid` when `isSpecialEvent` (cancellation card kept); embedded `?q=lat,lng&output=embed` map when `mapCoords` is set. |
| `src/components/cruise/ReviewSlider.tsx` | `isSpecialEvent` → rainbow "What people say" heading. |
| `src/components/booking/DateCardPicker.tsx` | New `fixedDate` prop → renders one static event-date card instead of the scroller + calendar. |
| `src/components/booking/BoatDurationStep.tsx` | New `offeredBoatIds` (omit non-offered boats) and `rainbowBoatCard` (gradient background) props. |
| `src/components/booking/TimeSlotStep.tsx` | New `rainbowTheme` prop → selected slot uses the gradient instead of solid brand fill. |
| `src/components/booking/booking-state.ts` | `BookingPanelProps` gains `offeredBoatIds`, `rainbowBoatCard`, `fixedDate`. |
| `src/components/booking/BookingPanel{Desktop,Slider}.tsx` | Thread the three new props through to the steps. |
| `src/lib/fareharbor/availability.ts` | **All-listings fix.** `transformToSlot` derives duration from the availability's own `start_at`/`end_at` when it spans real time, falling back to name-parsed duration otherwise. |
| `src/lib/cancellation/policy.ts` | **All-listings fix.** `formatTierLines` expresses large tiers in weeks/days ("3 weeks") via new `formatHours`/`formatHoursRange`; 24h/48h tiers unchanged. |
| `src/app/globals.css` | `.bg-rainbow-smooth` (drifting pastel card bg), `.text-rainbow-gradient` (animated) + `.text-rainbow-gradient-static` (headings), `@keyframes rainbow-drift`; all with reduced-motion fallbacks. |

## Architecture decisions

- **Detected by slug, configured in one place.** `SPECIAL_EVENTS` in `page.tsx` is the single source of truth — adding an event is one entry (date, slot length in hours, map coords). No new DB column or schema change; the listing itself is a plain `cruise_listings` row. This keeps a one-off feature from leaking config across the schema.

- **Duration from the slot, not the name (general fix).** Standard rental slots are departure-time-only (`end_at === start_at`) and duration comes from the picked customer type (e.g. "Diana - 2 Hours"), parsed by name. A "Special Event" type has no hour token in its name, so the old parser silently defaulted to 120min → the boat card showed "2h" for an 8-hour cruise. Now a real time-span on the availability wins; name-parsing remains the fallback so nothing else changes.

- **"Omit" vs "sold out".** `BoatDurationStep` treated any boat with no availability today as *sold out*. For an event that only ever offers one boat, the other boat isn't sold out — it was never on offer. `offeredBoatIds` (derived from `boats.fareharbor_customer_type_pks` ∩ the listing's `allowed_customer_type_pks`) filters those boats out of the render entirely. Empty/undefined preserves the old "show every boat" behaviour.

- **Whole-boat price is the headline.** A special event is a single fixed-price private charter, so "starting from €X/person" is the wrong frame — there's one price. The header leads with `starting_price × max_guests` (the boat total) and relegates per-person/per-hour to a secondary line. This branch is event-only; standard listings keep "starting from" because their price genuinely varies by boat/duration.

- **Map embed via `q=lat,lng`, not the share link.** A `maps.app.goo.gl/…` share link doesn't convert into an embeddable `pb=` iframe on its own. Storing resolved `lat,lng` in the config lets us use the keyless `https://www.google.com/maps?q=…&output=embed` form directly; the share link is still offered as an "Open in Google Maps" text link.

- **Canvas, not DOM nodes, for the cursor effect.** A trail is 20+ moving elements per frame; one `<canvas>` composited layer with `pointer-events:none` beats thrashing the DOM and never blocks the page. RAF-driven; cleaned up on unmount.

- **Rainbow as CSS utilities, gated in the page.** The gradients are plain classes in `globals.css` (with reduced-motion fallbacks) toggled by an `isSpecialEvent` flag — no per-component theming system, and zero effect on any non-event listing.

## How it works

1. `page.tsx` looks up `SPECIAL_EVENTS[listing.slug]`. A hit sets `isSpecialEvent`, `specialEventDate` (→ `fixedDate` + the widget's `initialDate`), `offeredBoatIds` (from `data.listingBoats`), `mapCoords`, and the whole-boat price.
2. Those flow as props into `BookingPanel` (→ Desktop/Slider → DateCardPicker / BoatDurationStep / TimeSlotStep) and into `CruiseContentSections`.
3. Each component branches on its flag: single date card, omitted boats, rainbow selected slot, open-bar card, embedded map, rainbow headings.
4. The rainbow cursor overlay mounts once for the Pride slug.

Everything is presentation over the **same** availability/booking pipeline — filtering, capacity, validation, and checkout are unchanged.

## How to extend

- **Add another special event** (e.g. King's Day): create its `cruise_listings` row + FareHarbor item/availability as usual, then add one line to `SPECIAL_EVENTS` with its `date`, slot `hours`, and `mapCoords`. Rainbow theming currently keys off `isSpecialEvent` (all events); if a future event wants different theming, add a `theme` field to the config and branch on it.
- **Change which boats an event offers:** it derives from the listing's `allowed_customer_type_pks` matched against `boats.fareharbor_customer_type_pks` — no code change.

## Dependencies / setup outside this code

The listing needs matching **FareHarbor + Supabase** state that does **not** live in git:

- A FareHarbor **item** (Pride uses pk `746948`, type Private) with per-boat "Special Event" customer types, per-boat "…- Private" resources (max-use 1, so one party books the whole boat), a single dated availability, and Bookability on.
- The `cruise_listings` row (slug `pride-amsterdam-2026`, `allowed_customer_type_pks` scoped to the event's type(s), content + translations).
- `boats.fareharbor_customer_type_pks` must include the event customer-type PKs (so `offeredBoatIds` can resolve).
- The parent `fareharbor_items.cancellation_tiers` drives the cancellation card (Pride: full refund up to 504h / 3 weeks, none after).

Complements the [virtual product layer](../implementation-plan.md) and [shared-cruise pricing](shared-cruise-pricing.md) (same booking pipeline, opposite framing: shared = per-person, event = whole-boat).

## Tests

`src/lib/cancellation/policy.test.ts` — new cases for the week/day tier formatting plus a guard that short-notice 24h/48h tiers still render in hours. The rest of the change is presentation (branching + CSS), verified in the browser against the live listing.

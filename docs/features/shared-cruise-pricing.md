# Shared-cruise multi-ticket pricing + adults-only extras

## What was built

Two related pricing fixes for **shared** cruises (per-person tickets like Adult / Child):

1. **Per-ticket-type pricing.** A shared booking can mix ticket types (e.g. 1 Adult + 1 Child). Previously the server priced *every* guest at the first ticket type's rate (Adult), so a child was charged as an adult — the booking total jumped at checkout (a real customer reported it via WhatsApp). Now each ticket type is verified against FareHarbor and summed individually.

2. **Adults-only extras.** Extras flagged `adults_only` (e.g. **Unlimited Drinks** — alcohol) are now priced for the **adult** headcount, not all guests. A boat of 1 adult + 1 child pays for 1 adult's drinks, both on the card label ("· for 1 adult") and at checkout (€15, not €30).

Also fixes the bug that surfaced this work: the client was sending the customer **type** PK where the server expected the customer-type **rate** PK (see Architecture decisions).

## Key files

| File | Role |
|------|------|
| `src/lib/booking/calculate-quote.ts` | Server-canonical pricing. New `customerTypeRates` input: verifies + sums each ticket type; derives `adultCount` from rate names and passes it to `calculateExtras`. |
| `src/lib/extras/calculate.ts` | `calculateExtras` gained an optional `adultCount`; `adults_only` per-person / per-person-per-hour extras bill by adults, everything else by total guests. |
| `src/lib/booking/adult-count.ts` | **New.** Shared `isChildLabel()` (infers child from the FH type name) + `countAdultsFromFHCustomers()`. Used by client and server so the displayed and charged adult count can't drift. |
| `src/app/api/booking-flow/quote/route.ts` | Accepts + persists `customerTypeRates` (in the `breakdown` jsonb). |
| `src/lib/booking/create-intent.ts` | Reads `customerTypeRates` from the stored quote, re-prices with it (drift check), and stamps it onto the PaymentIntent metadata. |
| `src/app/api/webhooks/stripe/route.ts` | Builds the FareHarbor `customers` array per ticket type from PI metadata (async/iDEAL path). |
| `src/app/api/admin/booking-flow/book/route.ts` | Same per-type `customers` construction for the admin/website book path. |
| `src/app/api/booking/extras/[id]/route.ts` | Post-booking catering upsell: reconstructs `adultCount` from the FareHarbor booking when re-pricing an `adults_only` extra. |
| `src/components/checkout/CheckoutFlow.tsx` | `buildCustomerTypeRates()` helper sends the correct **rate** PKs; `ticketBreakdown` for the summary. |
| `src/components/booking/{ExtraCard,ExtraListItem,ExtrasStep}.tsx` | Display the adult-only price + "for N adult(s)" label; thread `adultCount` into `formatPriceLabel`. |
| `src/components/admin/fareharbor/TimeSlotStep.tsx` | Admin shared-cruise booking uses per-type counters (not radios). |

## Architecture decisions

- **Two PKs, easy to confuse.** A public `AvailabilityCustomerType` carries `pk` (the customer-type **rate** PK — what FareHarbor availability + booking key on) and `customerTypePk` (the customer **type** PK — what `ticketCounts` is keyed by). The server and FH booking need the **rate** PK. Sending the type PK produces *"Could not find customer type rate &lt;pk&gt;"* and a dead checkout. `buildCustomerTypeRates()` sends `ct.pk` while reading counts by `ct.customerTypePk`.

- **One definition of "adult", shared.** FareHarbor has no adult/child flag; we infer it from the type name via `isChildLabel()`. That single function lives in `adult-count.ts` and is imported by both the booking panel (which shows the price) and the server (which charges it), so display and charge can never disagree.

- **Display mirrors charge.** `formatPriceLabel()` (card price) and `calculateExtras()` (charge) both apply the same `adults_only ? adultCount : guestCount` rule. Changing one without the other was the original "card says €30 but charges €15" inconsistency.

- **`adultCount` reconstruction for existing bookings.** The booking row stores only a single primary rate PK, not the split. The post-booking upsell rebuilds it from the FareHarbor booking's `customers` array (the source of truth, works for any booking), and only when it matters (shared cruise + an `adults_only` extra selected) to avoid an extra API call on the common path.

## How it works

Booking flow (client → server), all server-canonical — the client never sets prices:

1. **Quote** — `CheckoutFlow.buildCustomerTypeRates()` sends `{ pk: rate, count }[]`. `quote/route.ts` → `calculateQuote()` verifies each rate, sums, derives `adultCount`, prices `adults_only` extras for adults, and persists `customerTypeRates` in the quote's `breakdown`.
2. **Create intent** — `create-intent.ts` re-reads `customerTypeRates` from the stored quote, re-prices (drift guard), and writes `customer_type_rates` into the PaymentIntent metadata.
3. **Finalize** — the webhook (iDEAL/async) and the book route build the FareHarbor `customers` array with one entry per guest at the correct rate PK.

## How to extend

- **Make any extra adults-only:** set `adults_only = true` on the `extras` row. Pricing (`calculateExtras`), the card price (`formatPriceLabel`), the "for N adults" label, and the counter cap all follow automatically — no code change.
- **Add a new per-person price type:** handle it in `calculateExtras` and apply `headcountFor(extra)` so `adults_only` keeps working; mirror it in `formatPriceLabel`.

## Dependencies

- **FareHarbor** availability detail (`customer_type_rates[].customer_prototype.total_including_tax`) for verified gross prices, and the booking `customers[].customer_type_rate.customer_type.singular` for adult/child names.
- **`calculateExtras`** is the shared money function — quote, create-intent (drift check), the upsell, and the admin path all route through it.
- Depends on / complements [Booking claim mutex](booking-claim-mutex.md) and [Payment flow hardening](payment-flow-hardening.md).

## Tests

`calculate-quote.test.ts` (multi-rate + adults-only derivation), `calculate.test.ts` (adults-only headcount), `adult-count.test.ts` (`isChildLabel` / `countAdultsFromFHCustomers`), `ExtraCard.test.ts` (`formatPriceLabel` adult-only display). Includes the literal "type-pk vs rate-pk" error case as a regression lock.

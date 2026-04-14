# Booking Flow Design — Public Cruise Detail Page + Checkout

**Date:** 2026-04-07
**Status:** Design approved, pending implementation

## Context

The cruise detail page (`/cruises/[slug]`) has a `BookingWidget` in the right sidebar that handles date + guest selection and displays time slots. But the flow stops there — clicking a slot redirects to `/book/[slug]/checkout` which doesn't exist. Meanwhile, all the backend pieces (FareHarbor availability, Stripe PaymentIntents, extras calculation, booking creation) are fully built and working in the admin context. The job is to wire these into a public-facing booking flow.

## Design Decision Summary

- **One smart component** (`BookingPanel`) replaces the existing `BookingWidget`, handling private and shared tours via conditional rendering based on `listing.category`
- **Progressive accordion** — steps reveal one at a time, completed steps collapse to a summary line
- **Checkout page** is Airbnb-style two-column: guest form + Stripe on the left, booking summary on the right
- **Reuse admin components** — `ExtrasStep`, `PaymentForm`, Stripe setup, and all API routes are already battle-tested

---

## Architecture

### Component Tree

```
BookingPanel (right sidebar, sticky)
├── DateStep — calendar picker + guest counter (shared only)
├── TimeSlotStep — pill buttons, capacity bars (shared only)
├── BoatDurationStep (private) — boat cards with inline duration pills
├── TicketStep (shared) — customer type rows (adult/child) with +/- steppers
├── ExtrasStep (both modes) — reuse existing component
├── PriceSummary — always visible at bottom, live-updating
└── ProceedCTA — navigates to /book/[slug]/checkout

CheckoutPage (/book/[slug]/checkout)
├── Left column (60%):
│   ├── GuestInfoForm — name, email, phone, special requests
│   ├── StripePaymentElement — card, iDEAL, Bancontact, Link
│   ├── Terms checkbox + cancellation policy
│   └── "Confirm & Pay" CTA
└── Right column (40%, sticky):
    ├── Listing hero image + name
    ├── Date, time, boat/duration (private) or ticket count (shared)
    └── Full price breakdown
```

### State Flow

BookingPanel manages all state in a single `useReducer`:

```typescript
interface BookingPanelState {
  step: 'date' | 'time' | 'boat' | 'tickets' | 'extras' | 'ready'
  date: string | null           // YYYY-MM-DD
  guests: number                // for shared: total tickets; for private: informational
  slots: AvailabilitySlot[]     // from /api/search/slots
  selectedSlot: AvailabilitySlot | null
  selectedBoat: 'diana' | 'curacao' | null  // private only
  selectedCustomerType: AvailabilityCustomerType | null
  ticketCounts: Record<number, number>  // shared: customerTypePk → count
  selectedExtraIds: string[]
  extrasCalculation: ExtrasCalculation | null
}
```

On "Proceed to booking", the state is serialized to `sessionStorage` (for iDEAL redirect recovery) and key params are passed via URL to the checkout page.

---

## Step-by-Step UX

### Step 1 — Pick a Date

Full month-view calendar picker (using `react-day-picker` or similar, styled to brand).
- Navigable prev/next month
- Selected date: filled circle in brand indigo
- Today subtly marked
- **Private tours:** Calendar only — no guest counter needed (you book the whole boat)
- **Shared tours:** Calendar + guest counter (+/- with adult/child if needed), since ticket count affects capacity

When date is set (and guests for shared), fetch `/api/search/slots`. Step collapses to summary ("Sat 12 April") and step 2 slides in.

### Step 2 — Pick a Time

Available time slots as rounded pill buttons.

- **Shared tours:** Each pill shows a thin capacity bar (3px) along the bottom edge — green fill proportional to remaining spots. Color transitions: green (>50%) → amber (<30%) → red (<10%). Text below or on hover: "4 spots left".
- **Private tours:** Pills are binary — available (solid) or sold out (greyed + strikethrough). No capacity bar needed.
- Sold-out slots remain visible but disabled, so users understand the landscape.

Staggered fade-in animation (50ms delay between pills). Selected pill: indigo fill, white text, subtle scale-up.

### Step 3A — Private Tours: Boat + Duration

Two boat cards. Smart filtering:
- Diana does NOT appear if group > 8 guests
- Sold-out boat shows dimmed card + "Sold out" badge
- Available boat card shows duration pills inline: "1.5h · €165", "2h · €195", "3h · €245"
- Duration pills pull price from `customerType.priceCents` on the selected slot

Selecting a duration pill = boat + duration chosen. Card pulses subtly to confirm.

### Step 3B — Shared Tours: Pick Tickets

Customer type rows from the slot's `customerTypes` array:
- "Adult — €XX/person" with +/- stepper
- "Child — €XX/person" with +/- stepper
- City tax line calculated live: "City tax · 4 x €2.60 = €10.40"

### Step 4 — Extras (both modes)

Reuse existing `ExtrasStep` component. Required extras pre-selected and locked. Optional extras grouped by category with toggles. Running total updates live.

### Running Total (always visible)

Pinned at bottom of the panel. Number-roll animation on value changes.

```
Base price             €330.00
Skipper package         €30.00
City tax (4x)           €10.40
───────────────────────────────
Total (incl. 9% VAT)  €370.40
```

### "Proceed to booking" CTA

Full-width button. Disabled until minimum steps complete (date + time + boat/tickets). Navigates to checkout page.

---

## Checkout Page (`/book/[slug]/checkout`)

### Layout
Two-column Airbnb-style. Mobile: columns stack (summary becomes collapsible card at top).

### Left Column (60%)
1. **Guest Info Form**
   - Full name (required)
   - Email (required, for confirmation)
   - Phone (required)
   - "Celebrating something special?" (optional textarea)

2. **Payment**
   - Stripe Payment Element (card, iDEAL, Bancontact, Link)
   - Amount shown clearly above the element

3. **Terms**
   - Checkbox: "I agree to the cancellation policy and terms"

4. **"Confirm & Pay"** CTA button

### Right Column (40%, sticky)
Booking summary card:
- Small hero image of the cruise listing
- Cruise name
- Date + time
- Boat + duration (private) or ticket breakdown (shared)
- Extras list
- Full price breakdown (same as panel)
- Cancellation policy snippet

### Payment Flow
1. Guest fills form → clicks "Confirm & Pay"
2. Frontend calls `POST /api/booking-flow/create-intent` (reuse existing admin route, moved to public path)
3. Stripe confirms payment (or redirects for iDEAL)
4. On success: frontend calls `POST /api/booking-flow/book` to create FareHarbor booking
5. Redirect to `/book/[slug]/confirmation` with booking reference
6. iDEAL redirect: return URL restores state from `sessionStorage`, confirms payment, then books

---

## Animation & Visual Direction

- **Accordion transitions:** `framer-motion` `AnimatePresence` for step reveals (~300ms ease-out)
- **Completed step collapse:** Shrinks to single summary line with checkmark. Tappable to re-expand.
- **Time slot pills:** Staggered fade-in (50ms per pill). Hover: scale(1.03). Selected: indigo fill + bounce.
- **Capacity bars (shared):** Animated width on appearance. Green → amber → red gradient based on fill.
- **Price total:** Odometer-style number roll on value changes.
- **CTA button:** Subtle gradient shimmer on hover. Disabled: muted, no pointer.
- **Calendar:** Selected date gets filled circle with pop animation.

---

## Key Files to Create / Modify

### New Files
| File | Purpose |
|------|---------|
| `src/components/booking/BookingPanel.tsx` | Main orchestrator — replaces BookingWidget |
| `src/components/booking/DateStep.tsx` | Calendar picker + guest counter |
| `src/components/booking/TimeSlotStep.tsx` | Time slot pills with capacity bars |
| `src/components/booking/BoatDurationStep.tsx` | Private: boat cards + duration pills |
| `src/components/booking/TicketStep.tsx` | Shared: customer type rows |
| `src/components/booking/PriceSummary.tsx` | Running total with animation |
| `src/components/booking/StepAccordion.tsx` | Reusable accordion wrapper (animation) |
| `src/app/[locale]/book/[slug]/checkout/page.tsx` | Checkout page |
| `src/components/checkout/GuestInfoForm.tsx` | Name, email, phone, special requests |
| `src/components/checkout/BookingSummary.tsx` | Right-column summary card |
| `src/components/checkout/CheckoutFlow.tsx` | Client component orchestrating checkout |
| `src/app/api/booking-flow/create-intent/route.ts` | Public version of create-intent |
| `src/app/api/booking-flow/book/route.ts` | Public version of book endpoint |
| `src/app/[locale]/book/[slug]/confirmation/page.tsx` | Post-payment confirmation page |

### Modified Files
| File | Change |
|------|--------|
| `src/app/[locale]/cruises/[slug]/page.tsx` | Replace `BookingWidget` with `BookingPanel` |
| `src/types/index.ts` | Add `BookingPanelState`, `TicketSelection` types |
| `src/lib/i18n/messages/*.json` | Add booking flow translation keys |

### Reused As-Is
| File | What we reuse |
|------|---------------|
| `src/components/booking/ExtrasStep.tsx` | Extras selection UI |
| `src/components/booking/ExtraCard.tsx` | Individual extra card |
| `src/components/booking/ExtraCategoryGroup.tsx` | Category grouping |
| `src/lib/extras/calculate.ts` | Price calculation engine |
| `src/lib/fareharbor/availability.ts` | Availability fetching + filtering |
| `src/lib/fareharbor/filters.ts` | 3-layer filter system |
| `src/app/api/search/slots/route.ts` | Slot search API |

---

## Booking Successful Page (`/book/[slug]/confirmation`)

After payment succeeds and the FareHarbor booking is created, the user lands here. This is the "you're all set" moment.

### Content
- Big checkmark / success animation (confetti? subtle, on-brand)
- "You're all set!" heading
- Booking reference number (from FareHarbor UUID)
- Summary card: cruise name, date, time, boat (private) or ticket count (shared), duration
- "A confirmation email has been sent to [email]"
- What to expect section: meeting point, what to bring, skipper info
- "Add to calendar" button (Google Cal / Apple Cal / .ics download)
- "Back to homepage" link

### Technical
- Page receives `?booking_id=...` or `?payment_intent=...` as URL param
- Fetches booking details from Supabase `bookings` table (by stripe_payment_intent_id)
- If no booking found (direct URL access), show graceful fallback: "Can't find this booking. Check your email for confirmation."
- Server-rendered where possible for instant load after the redirect

---

## City Tax Implementation

€2.60 per person. Calculated client-side for display, verified server-side in `create-intent`.
- **Private tours:** city tax = guestCount x €2.60
- **Shared tours:** city tax = total tickets x €2.60
- Shown as a line item in PriceSummary
- Stored in booking metadata

---

## Testing Plan

1. **Unit tests:** PriceSummary calculation (city tax + extras + base), step state transitions
2. **Integration:** Full flow from date selection → checkout → payment confirmation
3. **Edge cases:** Sold-out boats, Diana full → Curaçao fallback, iDEAL redirect recovery
4. **Mobile:** Test at 375px, 390px, 768px, 1280px breakpoints
5. **Verify via Chrome MCP:** Browse localhost:3000, walk through both private and shared flows

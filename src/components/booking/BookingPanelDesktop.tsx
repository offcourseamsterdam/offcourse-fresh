'use client'

/**
 * BookingPanelDesktop — Booking.com-style one-screen desktop panel.
 *
 * Two-card layout so the sticky behaviour feels natural:
 *
 *   ┌────────────────────────┐  ← normal flow, scrolls with the page
 *   │  Date picker           │
 *   │  Guest counter         │  (private only)
 *   └────────────────────────┘
 *   ┌────────────────────────┐  ← sticky top-[~208px] — sticks once card 1 scrolls off
 *   │  Select time           │
 *   │  Cruise details        │  (appears after slot selected)
 *   │  Extras + Price        │  (appears after boat/ticket chosen)
 *   │  Proceed button        │
 *   └────────────────────────┘
 *
 * Mobile uses BookingPanelSlider (unchanged).
 */

import { useEffect, useRef } from 'react'
import { useMemo } from 'react'
import { DateCardPicker } from './DateCardPicker'
import { TimeSlotStep } from './TimeSlotStep'
import { BoatDurationStep } from './BoatDurationStep'
import { TicketStep } from './TicketStep'
import { ExtrasStep } from './ExtrasStep'
import { PriceSummary } from './PriceSummary'
import { CancellationCutoffRow } from './CancellationCutoffRow'
import { Button } from '@/components/ui/button'
import { fmtEuros, getToday, toDateStr } from '@/lib/utils'
import { useBookingPanel } from './useBookingPanel'
import type { BookingPanelProps } from './booking-state'

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-avenir font-semibold text-[15px] text-[var(--color-ink)] mb-3">
      {children}
    </p>
  )
}

// ── Guest counter ─────────────────────────────────────────────────────────────

function GuestCounter({ guests, onChange }: { guests: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
      <span className="text-sm font-medium text-zinc-800">Guests</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, guests - 1))}
          disabled={guests <= 1}
          aria-label="Remove one guest"
          className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 transition-colors"
        >
          <span className="text-lg leading-none" aria-hidden="true">−</span>
        </button>
        <span
          className="w-6 text-center font-semibold text-zinc-800 tabular-nums"
          aria-live="polite"
          aria-label={`${guests} guest${guests !== 1 ? 's' : ''}`}
        >{guests}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(12, guests + 1))}
          disabled={guests >= 12}
          aria-label="Add one guest"
          className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 transition-colors"
        >
          <span className="text-lg leading-none" aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  )
}

// ── Cancellation note ─────────────────────────────────────────────────────────

function CancellationLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-[var(--color-muted)] text-sm mb-3">
      <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
      </svg>
      <span>{text.length > 40 ? 'Free cancellation' : text}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function BookingPanelDesktop(props: BookingPanelProps) {
  const { sidebarHeader } = props
  const {
    state, dispatch, category,
    handleInlineDateSelect, handleGuestsConfirm, handleExtrasChange, handleProceedToCheckout,
    fetchSlots,
    basePriceCents, guestCount, adultCount, cityTaxCents, ticketBreakdown, cruiseLabel,
    listingId,
  } = useBookingPanel(props)

  const isPrivate = category === 'private'
  const hasSlotSelected = !!state.selectedSlot
  const hasBoatSelected = isPrivate ? !!state.selectedCustomerType : state.totalTickets > 0
  const showExtras = state.step === 'extras'

  // Enforce FareHarbor minimum party size for shared cruises — mirrors the
  // server-side check so the user can't proceed to checkout with fewer
  // tickets than FareHarbor will accept (avoids a charged-but-unbooked state).
  const minParty = !isPrivate && state.selectedSlot
    ? Math.max(...state.selectedSlot.customerTypes.map(ct => ct.minimumParty ?? 1), 1)
    : 1
  const belowMinParty = !isPrivate && state.totalTickets > 0 && state.totalTickets < minParty

  // ── Fetch slots for private on mount (hook only auto-fetches for shared) ──
  const hasFetchedPrivate = useRef(false)
  useEffect(() => {
    if (!isPrivate || hasFetchedPrivate.current) return
    if (!state.date || state.loadingSlots) return
    if (state.slots.length > 0) return
    hasFetchedPrivate.current = true
    fetchSlots(state.date, state.guests)
  }, [isPrivate, state.date, state.loadingSlots, state.slots, state.guests, fetchSlots])

  // ── Auto-select first available slot ─────────────────────────────────────
  // When slots are loaded and none is selected, pick the first available one
  // so the cruise-details / ticket section appears immediately.
  useEffect(() => {
    if (state.loadingSlots || state.selectedSlot || state.slots.length === 0) return
    const first = state.slots.find(s => s.capacity >= 1 && !s.callToBook)
    if (first) dispatch({ type: 'SELECT_SLOT', slot: first, category })
  }, [state.slots, state.selectedSlot, state.loadingSlots, category, dispatch])

  // ── Suggest next date when fully booked ──────────────────────────────────
  const suggestDate = useMemo(() => {
    if (!state.date) return undefined
    const d = new Date(state.date + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    const today = getToday()
    return {
      label: state.date === toDateStr(today) ? 'tomorrow'
        : d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }),
      dateStr: toDateStr(d),
    }
  }, [state.date])

  return (
    <div className="space-y-4">

      {/* ── Card 1: Date + guests ───────────────────────────────────────────
          Normal flow — scrolls with the page. Once this card is past the
          viewport, the time card below sticks into view naturally. */}
      <div className="bg-white rounded-2xl shadow-lg border border-zinc-100 p-5 space-y-6">

        <DateCardPicker
          selectedDate={state.date}
          onSelectDate={handleInlineDateSelect}
        />

        {isPrivate && (
          <div>
            <SectionLabel>How many guests?</SectionLabel>
            <GuestCounter guests={state.guests} onChange={handleGuestsConfirm} />
          </div>
        )}
      </div>

      {/* ── Card 2: "Start Cruising" header + time + booking ──────────────
          Sticky — sticks at the navbar bottom (~96 px). The header and the
          time/booking content are one unified block so they move together.
          The date/guests card above scrolls off before this card sticks. */}
      <div className="sticky top-24">
        <div className="bg-white rounded-2xl shadow-lg border border-zinc-100 p-5 space-y-5">

          {/* "Start Cruising" header — injected from the cruise page so the
              heading + price/pills live at the top of the sticky block */}
          {sidebarHeader && (
            <div className="border-b border-zinc-100 pb-4 -mx-5 px-5 -mt-5 pt-5 rounded-t-2xl">
              {sidebarHeader}
            </div>
          )}

          {/* Select time */}
          {state.date && (
            <div>
              <SectionLabel>Select time</SectionLabel>
              <TimeSlotStep
                slots={state.slots}
                loading={state.loadingSlots}
                mode={category}
                selectedSlotPk={state.selectedSlot?.pk ?? null}
                onSelect={(slot) => dispatch({ type: 'SELECT_SLOT', slot, category })}
                suggestDate={suggestDate ? {
                  label: suggestDate.label,
                  onSelect: () => handleInlineDateSelect(suggestDate.dateStr),
                } : undefined}
              />
            </div>
          )}

          {/* Cruise details / Ticket — appears after a slot is selected */}
          {hasSlotSelected && (
            <div className="border-2 border-[var(--color-primary)] rounded-2xl p-5">
              {isPrivate ? (
                <>
                  <h3 className="font-avenir font-bold text-base text-[var(--color-ink)] mb-1">
                    Cruise details
                  </h3>
                  {props.cancellationPolicy && <CancellationLine text={props.cancellationPolicy} />}
                  <BoatDurationStep
                    customerTypes={state.selectedSlot!.customerTypes}
                    guests={state.guests}
                    selectedCustomerTypePk={state.selectedCustomerType?.pk ?? null}
                    onSelect={(ct, boatId) =>
                      dispatch({ type: 'SELECT_BOAT_DURATION', customerType: ct, boatId })
                    }
                    allSlots={state.slots}
                    selectedSlot={state.selectedSlot}
                    onSelectSlot={(slot) => dispatch({ type: 'SELECT_SLOT', slot, category: 'private' })}
                  />
                </>
              ) : (
                <>
                  <h3 className="font-avenir font-bold text-base text-[var(--color-ink)] mb-1">
                    Ticket
                  </h3>
                  {props.cancellationPolicy && <CancellationLine text={props.cancellationPolicy} />}
                  <TicketStep
                    customerTypes={state.selectedSlot!.customerTypes}
                    ticketCounts={state.ticketCounts}
                    maxCapacity={state.selectedSlot!.capacity}
                    onUpdateCount={(pk, count) =>
                      dispatch({ type: 'UPDATE_TICKET_COUNT', customerTypePk: pk, count })
                    }
                    onConfirm={() => {}}
                  />
                </>
              )}

              {/* Running total inside the selection box */}
              {basePriceCents > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-avenir font-bold text-base text-[var(--color-ink)]">Total</span>
                    <span className="font-avenir font-bold text-base text-[var(--color-ink)]">
                      {fmtEuros(basePriceCents + cityTaxCents)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">Includes taxes and charges</p>
                </div>
              )}
            </div>
          )}

          {/* Shared: "Next → Extras" button (private auto-advances on boat select) */}
          {!isPrivate && hasBoatSelected && !showExtras && (
            <Button
              variant="primary"
              size="lg"
              className="w-full rounded-xl text-base font-bold"
              onClick={() => dispatch({ type: 'CONFIRM_TICKETS' })}
              disabled={belowMinParty}
            >
              {belowMinParty
                ? `Add ${minParty - state.totalTickets} more ticket${minParty - state.totalTickets !== 1 ? 's' : ''} to continue`
                : 'Next: Add extras'}
            </Button>
          )}

          {/* Extras + full price summary + Proceed */}
          {showExtras && (
            <div className="space-y-4">
              <div className="border border-zinc-200 rounded-2xl p-5">
                <h3 className="font-avenir font-bold text-base text-[var(--color-ink)] mb-3">
                  Add food, drinks &amp; extras
                </h3>
                <ExtrasStep
                  listingId={listingId}
                  guestCount={guestCount}
                  adultCount={adultCount}
                  baseAmountCents={basePriceCents}
                  durationMinutes={state.selectedCustomerType?.durationMinutes}
                  onExtrasChange={handleExtrasChange}
                />
              </div>

              {basePriceCents > 0 && (
                <div className="space-y-3">
                  <PriceSummary
                    basePriceCents={basePriceCents}
                    extrasCalculation={state.extrasCalculation}
                    mode={category}
                    cruiseLabel={cruiseLabel}
                    ticketBreakdown={ticketBreakdown}
                    cityTaxCents={cityTaxCents}
                  />
                  <CancellationCutoffRow tiers={props.cancellationTiers} slot={state.selectedSlot} />
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full rounded-xl text-base font-bold"
                    onClick={handleProceedToCheckout}
                  >
                    Proceed to booking
                  </Button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

'use client'

import { DateCardPicker } from './DateCardPicker'
import { TimeSlotStep } from './TimeSlotStep'
import { BoatDurationStep } from './BoatDurationStep'
import { TicketStep } from './TicketStep'
import { ExtrasStep } from './ExtrasStep'
import { PriceSummary } from './PriceSummary'
import { Button } from '@/components/ui/button'
import { fmtEuros } from '@/lib/utils'
import { useBookingPanel } from './useBookingPanel'
import type { BookingPanelProps } from './booking-state'

export function BookingPanelInline(props: BookingPanelProps) {
  const {
    state, dispatch, category,
    timeSlotsRef, bookingCardRef, extrasRef,
    handleInlineDateSelect, handleInlineGuestChange, handleExtrasChange, handleProceedToCheckout,
    basePriceCents, guestCount, cityTaxCents, ticketBreakdown, boatSummary,
    listingId,
  } = useBookingPanel(props)

  const hasDate = !!state.date
  const hasTime = !!state.selectedSlot
  const hasBoatOrTickets = category === 'private' ? !!state.selectedCustomerType : state.totalTickets > 0
  const showExtras = state.step === 'extras'

  return (
    <div className="space-y-6">
      {/* Date card picker */}
      <DateCardPicker
        selectedDate={state.date}
        onSelectDate={handleInlineDateSelect}
      />

      {/* Time slots — shown after date selection */}
      {hasDate && (
        <div ref={timeSlotsRef}>
          <p className="font-avenir font-semibold text-[15px] text-[var(--color-ink)] mb-3">
            Select time
          </p>
          <TimeSlotStep
            slots={state.slots}
            loading={state.loadingSlots}
            mode={category}
            selectedSlotPk={state.selectedSlot?.pk ?? null}
            onSelect={(slot) => {
              dispatch({ type: 'SELECT_SLOT', slot, category })
              setTimeout(() => bookingCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
            }}
          />
        </div>
      )}

      {/* Booking card — shown after time selection */}
      {hasTime && (
        <div ref={bookingCardRef} className="border-2 border-[var(--color-primary)] rounded-2xl p-5 bg-white">
          <h3 className="font-avenir font-bold text-base text-[var(--color-ink)] mb-1">
            {category === 'private' ? 'Cruise details' : 'Ticket'}
          </h3>

          {/* Cancellation info */}
          {props.cancellationPolicy && (
            <div className="flex items-center gap-2 text-[var(--color-muted)] text-sm mb-4">
              <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
              </svg>
              <span>{props.cancellationPolicy.length > 40 ? 'Free cancellation' : props.cancellationPolicy}</span>
            </div>
          )}

          {/* Private: boat + duration */}
          {category === 'private' && state.selectedSlot && (
            <div className="space-y-5">
              <BoatDurationStep
                customerTypes={state.selectedSlot.customerTypes}
                guests={state.guests}
                selectedCustomerTypePk={state.selectedCustomerType?.pk ?? null}
                onSelect={(ct, boatId) => dispatch({ type: 'SELECT_BOAT_DURATION', customerType: ct, boatId })}
              />

              {/* Guest counter */}
              <div>
                <p className="font-avenir font-semibold text-sm text-[var(--color-ink)] mb-2">How many guests?</p>
                <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
                  <span className="text-sm font-medium text-zinc-800">Guests</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleInlineGuestChange(Math.max(1, state.guests - 1))}
                      disabled={state.guests <= 1}
                      className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 transition-colors"
                    >
                      <span className="text-lg leading-none">−</span>
                    </button>
                    <span className="w-6 text-center font-semibold text-zinc-800 tabular-nums">{state.guests}</span>
                    <button
                      type="button"
                      onClick={() => handleInlineGuestChange(Math.min(12, state.guests + 1))}
                      disabled={state.guests >= 12}
                      className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 transition-colors"
                    >
                      <span className="text-lg leading-none">+</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shared: ticket counters */}
          {category === 'shared' && state.selectedSlot && (
            <TicketStep
              customerTypes={state.selectedSlot.customerTypes}
              ticketCounts={state.ticketCounts}
              maxCapacity={state.selectedSlot.capacity}
              onUpdateCount={(pk, count) => dispatch({ type: 'UPDATE_TICKET_COUNT', customerTypePk: pk, count })}
              onConfirm={() => dispatch({ type: 'CONFIRM_TICKETS' })}
            />
          )}

          {/* Total + Next */}
          {basePriceCents > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-100">
              <div className="flex items-center justify-between mb-1">
                <span className="font-avenir font-bold text-base text-[var(--color-ink)]">Total</span>
                <span className="font-avenir font-bold text-base text-[var(--color-ink)]">{fmtEuros(basePriceCents + cityTaxCents)}</span>
              </div>
              <p className="text-xs text-[var(--color-muted)] mb-4">Includes taxes and charges</p>

              {!showExtras && (
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="md"
                    className="rounded-xl font-bold px-10"
                    onClick={() => {
                      if (category === 'private' && state.selectedCustomerType) {
                        dispatch({ type: 'REOPEN_STEP', step: 'extras' })
                      } else if (category === 'shared' && state.totalTickets > 0) {
                        dispatch({ type: 'CONFIRM_TICKETS' })
                      }
                      setTimeout(() => extrasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
                    }}
                    disabled={!hasBoatOrTickets}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Extras step */}
      {showExtras && (
        <div ref={extrasRef} className="border border-zinc-200 rounded-2xl p-5 bg-white">
          <h3 className="font-avenir font-bold text-base text-[var(--color-ink)] mb-3">
            Add food, drinks & extras
          </h3>
          <ExtrasStep
            listingId={listingId}
            guestCount={guestCount}
            baseAmountCents={basePriceCents}
            durationMinutes={state.selectedCustomerType?.durationMinutes ?? state.selectedSlot?.customerTypes[0]?.durationMinutes}
            onExtrasChange={handleExtrasChange}
          />
        </div>
      )}

      {/* Price Summary + Proceed */}
      {showExtras && basePriceCents > 0 && (
        <div className="space-y-4">
          <PriceSummary
            basePriceCents={basePriceCents}
            extrasCalculation={state.extrasCalculation}
            mode={category}
            cruiseLabel={boatSummary}
            ticketBreakdown={ticketBreakdown}
            cityTaxCents={cityTaxCents}
          />
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
  )
}

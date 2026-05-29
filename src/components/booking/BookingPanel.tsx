'use client'

import { BookingStepTabs } from './BookingStepTabs'
import { DateStep } from './DateStep'
import { GuestStep } from './GuestStep'
import { TimeSlotStep } from './TimeSlotStep'
import { BoatDurationStep } from './BoatDurationStep'
import { TicketStep } from './TicketStep'
import { ExtrasStep } from './ExtrasStep'
import { PriceSummary } from './PriceSummary'
import { CancellationCutoffRow } from './CancellationCutoffRow'
import { Button } from '@/components/ui/button'
import { BookingPanelSlider } from './BookingPanelSlider'
import { useBookingPanel } from './useBookingPanel'
import type { BookingPanelProps } from './booking-state'

export type { BookingPanelProps } from './booking-state'

export function BookingPanel(props: BookingPanelProps) {
  if (props.layout === 'inline') return <BookingPanelSlider {...props} />
  return <BookingPanelSidebar {...props} />
}

// ── Sidebar layout (accordion-based, desktop) ──────────────────────────────

function BookingPanelSidebar(props: BookingPanelProps) {
  const {
    state, dispatch, category, steps,
    handleDateConfirm, handleGuestsConfirm, handleExtrasChange, handleProceedToCheckout,
    isStepCompleted,
    dateSummary, guestsSummary, timeSummary, boatSummary, boatDurationLabel, cruiseLabel,
    ticketSummary, extrasSummary,
    basePriceCents, guestCount, adultCount, cityTaxCents, ticketBreakdown,
    listingId,
  } = useBookingPanel(props)

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-zinc-100 p-4">
      {/* Step tabs — pills + starting-price moved to the section header above this card */}
      <BookingStepTabs
        steps={steps}
        currentStep={state.step}
        isCompleted={isStepCompleted}
        summaries={{
          date: dateSummary,
          guests: guestsSummary,
          time: timeSummary,
          boat: boatSummary
            ? boatDurationLabel
              ? { value: boatSummary, subline: boatDurationLabel }
              : boatSummary
            : undefined,
          tickets: ticketSummary,
          extras: extrasSummary,
        }}
        onStepClick={(step) => dispatch({ type: 'REOPEN_STEP', step })}
      />

      {/* Active-step body */}
      <div className="pt-4">
        {state.step === 'date' && (
          <DateStep
            mode={category}
            initialDate={state.date || undefined}
            initialGuests={state.guests}
            onConfirm={handleDateConfirm}
          />
        )}

        {state.step === 'guests' && category === 'private' && (
          <GuestStep
            initialGuests={state.guests}
            maxGuests={12}
            onConfirm={handleGuestsConfirm}
          />
        )}

        {state.step === 'time' && (
          <TimeSlotStep
            slots={state.slots}
            loading={state.loadingSlots}
            mode={category}
            selectedSlotPk={state.selectedSlot?.pk ?? null}
            onSelect={(slot) => dispatch({ type: 'SELECT_SLOT', slot, category })}
          />
        )}

        {state.step === 'boat' && category === 'private' && state.selectedSlot && (
          <BoatDurationStep
            customerTypes={state.selectedSlot.customerTypes}
            guests={state.guests}
            selectedCustomerTypePk={state.selectedCustomerType?.pk ?? null}
            onSelect={(ct, boatId) => dispatch({ type: 'SELECT_BOAT_DURATION', customerType: ct, boatId })}
            allSlots={state.slots}
            selectedSlot={state.selectedSlot}
            onSelectSlot={(slot) => dispatch({ type: 'SELECT_SLOT', slot, category: 'private' })}
          />
        )}

        {state.step === 'tickets' && category === 'shared' && state.selectedSlot && (
          <>
            <TicketStep
              customerTypes={state.selectedSlot.customerTypes}
              ticketCounts={state.ticketCounts}
              maxCapacity={state.selectedSlot.capacity}
              onUpdateCount={(pk, count) => dispatch({ type: 'UPDATE_TICKET_COUNT', customerTypePk: pk, count })}
              onConfirm={() => dispatch({ type: 'CONFIRM_TICKETS' })}
            />
            {state.totalTickets > 0 && (
              <div className="mt-3 flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  className="rounded-xl font-bold px-8"
                  onClick={() => dispatch({ type: 'CONFIRM_TICKETS' })}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        {state.step === 'extras' && (
          <ExtrasStep
            listingId={listingId}
            guestCount={guestCount}
            adultCount={adultCount}
            baseAmountCents={basePriceCents}
            durationMinutes={state.selectedCustomerType?.durationMinutes}
            onExtrasChange={handleExtrasChange}
          />
        )}
      </div>

      {basePriceCents > 0 && (
        <PriceSummary
          basePriceCents={basePriceCents}
          extrasCalculation={state.extrasCalculation}
          mode={category}
          cruiseLabel={cruiseLabel}
          ticketBreakdown={ticketBreakdown}
          cityTaxCents={cityTaxCents}
        />
      )}

      {state.step === 'extras' && (
        <div className="mt-5 space-y-3">
          {/* Cancellation deadline above the proceed button — visible even when the button
              gets cropped by the viewport. */}
          <CancellationCutoffRow tiers={props.cancellationTiers} slot={state.selectedSlot} />
          <Button variant="primary" size="lg" className="w-full rounded-xl text-base font-bold" onClick={handleProceedToCheckout}>
            Proceed to booking
          </Button>
        </div>
      )}
    </div>
  )
}

'use client'

import { StepAccordion } from './StepAccordion'
import { DateStep } from './DateStep'
import { GuestStep } from './GuestStep'
import { TimeSlotStep } from './TimeSlotStep'
import { BoatDurationStep } from './BoatDurationStep'
import { TicketStep } from './TicketStep'
import { ExtrasStep } from './ExtrasStep'
import { PriceSummary } from './PriceSummary'
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
    state, dispatch, category,
    handleDateConfirm, handleGuestsConfirm, handleExtrasChange, handleProceedToCheckout,
    isStepCompleted, isStepActive, stepNumber,
    dateSummary, guestsSummary, timeSummary, boatSummary, ticketSummary,
    basePriceCents, guestCount, cityTaxCents, ticketBreakdown,
    listingId,
  } = useBookingPanel(props)

  const infoPills = props.infoPills ?? []

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-zinc-100 p-4">
      {/* Info pills */}
      {infoPills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {infoPills.map((pill, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)] bg-[var(--color-sand)] px-2 py-0.5 rounded-full">
              {pill.icon === 'duration' && (
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" /></svg>
              )}
              {pill.icon === 'guests' && (
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
              )}
              {pill.label}
            </span>
          ))}
        </div>
      )}

      <StepAccordion title="Pick a date" summary={dateSummary} stepNumber={stepNumber('date')} isActive={isStepActive('date')} isCompleted={isStepCompleted('date')} onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'date' })}>
        <DateStep mode={category} initialDate={state.date || undefined} initialGuests={state.guests} onConfirm={handleDateConfirm} />
      </StepAccordion>

      {category === 'private' && (
        <StepAccordion title="How many guests?" summary={guestsSummary} stepNumber={stepNumber('guests')} isActive={isStepActive('guests')} isCompleted={isStepCompleted('guests')} onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'guests' })}>
          <GuestStep initialGuests={state.guests} maxGuests={12} onConfirm={handleGuestsConfirm} />
        </StepAccordion>
      )}

      <StepAccordion title="Pick a time" summary={timeSummary} stepNumber={stepNumber('time')} isActive={isStepActive('time')} isCompleted={isStepCompleted('time')} onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'time' })}>
        <TimeSlotStep slots={state.slots} loading={state.loadingSlots} mode={category} selectedSlotPk={state.selectedSlot?.pk ?? null} onSelect={(slot) => dispatch({ type: 'SELECT_SLOT', slot, category })} />
      </StepAccordion>

      {category === 'private' && (
        <StepAccordion title="Choose your boat" summary={boatSummary} stepNumber={stepNumber('boat')} isActive={isStepActive('boat')} isCompleted={isStepCompleted('boat')} onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'boat' })}>
          {state.selectedSlot && (
            <BoatDurationStep customerTypes={state.selectedSlot.customerTypes} guests={state.guests} selectedCustomerTypePk={state.selectedCustomerType?.pk ?? null} onSelect={(ct, boatId) => dispatch({ type: 'SELECT_BOAT_DURATION', customerType: ct, boatId })} allSlots={state.slots} selectedSlot={state.selectedSlot} onSelectSlot={(slot) => dispatch({ type: 'SELECT_SLOT', slot, category: 'private' })} />
          )}
        </StepAccordion>
      )}

      {category === 'shared' && (
        <StepAccordion title="Select tickets" summary={ticketSummary} stepNumber={stepNumber('tickets')} isActive={isStepActive('tickets')} isCompleted={isStepCompleted('tickets')} onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'tickets' })}>
          {state.selectedSlot && (
            <>
              <TicketStep customerTypes={state.selectedSlot.customerTypes} ticketCounts={state.ticketCounts} maxCapacity={state.selectedSlot.capacity} onUpdateCount={(pk, count) => dispatch({ type: 'UPDATE_TICKET_COUNT', customerTypePk: pk, count })} onConfirm={() => dispatch({ type: 'CONFIRM_TICKETS' })} />
              {state.totalTickets > 0 && (
                <div className="mt-3 flex justify-end">
                  <Button variant="primary" size="md" className="rounded-xl font-bold px-8" onClick={() => dispatch({ type: 'CONFIRM_TICKETS' })}>
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </StepAccordion>
      )}

      <StepAccordion title="Add food, drinks & extras" summary={state.selectedExtraIds.length > 0 ? `${state.selectedExtraIds.length} extras selected` : undefined} stepNumber={stepNumber('extras')} isActive={isStepActive('extras')} isCompleted={isStepCompleted('extras')} onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'extras' })}>
        <ExtrasStep listingId={listingId} guestCount={guestCount} baseAmountCents={basePriceCents} durationMinutes={state.selectedCustomerType?.durationMinutes ?? state.selectedSlot?.customerTypes[0]?.durationMinutes} onExtrasChange={handleExtrasChange} />
      </StepAccordion>

      {basePriceCents > 0 && (
        <PriceSummary basePriceCents={basePriceCents} extrasCalculation={state.extrasCalculation} mode={category} cruiseLabel={boatSummary} ticketBreakdown={ticketBreakdown} cityTaxCents={cityTaxCents} />
      )}

      {state.step === 'extras' && (
        <div className="mt-5">
          <Button variant="primary" size="lg" className="w-full rounded-xl text-base font-bold" onClick={handleProceedToCheckout}>
            Proceed to booking
          </Button>
        </div>
      )}
    </div>
  )
}

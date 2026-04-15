'use client'

import { useState, useCallback, useMemo } from 'react'
import { DateCardPicker } from './DateCardPicker'
import { TimeSlotStep } from './TimeSlotStep'
import { BoatDurationStep } from './BoatDurationStep'
import { TicketStep } from './TicketStep'
import { ExtrasStep } from './ExtrasStep'
import { PriceSummary } from './PriceSummary'
import { BookingSummaryTabs } from './BookingSummaryTabs'
import { Button } from '@/components/ui/button'
import { fmtEuros } from '@/lib/utils'
import { useBookingPanel } from './useBookingPanel'
import type { BookingPanelProps } from './booking-state'

export function BookingPanelSlider(props: BookingPanelProps) {
  const {
    state, dispatch, category,
    timeSlotsRef, bookingCardRef, extrasRef,
    handleInlineDateSelect, handleInlineGuestChange, handleExtrasChange, handleProceedToCheckout,
    basePriceCents, guestCount, cityTaxCents, ticketBreakdown, boatSummary,
    dateSummary, guestsSummary, timeSummary, ticketSummary,
    listingId,
  } = useBookingPanel(props)

  // ── Panel index ──────────────────────────────────────────────────────────

  // Private: 0=date, 1=guests, 2=time, 3=boat, 4=extras
  // Shared:  0=date+time+tickets, 1=extras
  const [panelIndex, setPanelIndex] = useState(0)

  const totalPanels = category === 'private' ? 5 : 2

  // ── Summary tabs for completed steps ──────────────────────────────────────

  const summaryTabs = useMemo(() => {
    const tabs: { label: string; panelIndex: number }[] = []

    if (category === 'private') {
      if (panelIndex > 0 && dateSummary) tabs.push({ label: dateSummary, panelIndex: 0 })
      if (panelIndex > 1 && guestsSummary) tabs.push({ label: guestsSummary, panelIndex: 1 })
      if (panelIndex > 2 && timeSummary) tabs.push({ label: timeSummary, panelIndex: 2 })
      if (panelIndex > 3 && boatSummary) tabs.push({ label: boatSummary, panelIndex: 3 })
    } else {
      // Shared: panel 0 is date+time+tickets, panel 1 is extras
      if (panelIndex > 0) {
        if (dateSummary) tabs.push({ label: dateSummary, panelIndex: 0 })
        if (timeSummary) tabs.push({ label: timeSummary, panelIndex: 0 })
        if (ticketSummary) tabs.push({ label: ticketSummary, panelIndex: 0 })
      }
    }

    return tabs
  }, [category, panelIndex, dateSummary, guestsSummary, timeSummary, boatSummary, ticketSummary])

  // ── Navigation ────────────────────────────────────────────────────────────

  const goToPanel = useCallback((index: number) => {
    setPanelIndex(Math.max(0, Math.min(index, totalPanels - 1)))
  }, [totalPanels])

  const handleTabClick = useCallback((targetPanel: number) => {
    goToPanel(targetPanel)
    // Reopen the appropriate step in the reducer
    if (category === 'private') {
      const stepMap = ['date', 'guests', 'time', 'boat', 'extras'] as const
      dispatch({ type: 'REOPEN_STEP', step: stepMap[targetPanel] })
    } else {
      dispatch({ type: 'REOPEN_STEP', step: targetPanel === 0 ? 'date' : 'extras' })
    }
  }, [category, dispatch, goToPanel])

  const advancePanel = useCallback(() => {
    if (panelIndex < totalPanels - 1) {
      setPanelIndex(panelIndex + 1)
    }
  }, [panelIndex, totalPanels])

  // ── Private tour panel helpers ────────────────────────────────────────────

  const canAdvanceDate = !!state.date
  const canAdvanceGuests = state.guests > 0
  const canAdvanceTime = !!state.selectedSlot
  const canAdvanceBoat = !!state.selectedCustomerType

  // ── Render ────────────────────────────────────────────────────────────────

  if (category === 'private') {
    return <PrivateSlider />
  }
  return <SharedSlider />

  // ── PRIVATE FLOW ──────────────────────────────────────────────────────────

  function PrivateSlider() {
    return (
      <div className="space-y-0">
        {/* Summary tabs */}
        <BookingSummaryTabs tabs={summaryTabs} currentPanel={panelIndex} onTabClick={handleTabClick} />

        {/* Sliding container */}
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${panelIndex * 100}%)` }}
          >
            {/* Panel 0: DATE */}
            <div className="min-w-full">
              <DateCardPicker
                selectedDate={state.date}
                onSelectDate={(date) => {
                  handleInlineDateSelect(date)
                  // Auto-advance to guests after selecting date
                  setTimeout(() => setPanelIndex(1), 150)
                }}
              />
              {canAdvanceDate && (
                <div className="flex justify-end mt-4">
                  <Button variant="primary" size="md" className="rounded-xl font-bold px-10" onClick={() => setPanelIndex(1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>

            {/* Panel 1: GUESTS */}
            <div className="min-w-full">
              <div className="space-y-4">
                <p className="font-avenir font-semibold text-[15px] text-[var(--color-ink)]">How many guests?</p>
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
                <div className="flex justify-end">
                  <Button variant="primary" size="md" className="rounded-xl font-bold px-10" onClick={() => {
                    dispatch({ type: 'CONFIRM_GUESTS', guests: state.guests })
                    setPanelIndex(2)
                  }}>
                    Next
                  </Button>
                </div>
              </div>
            </div>

            {/* Panel 2: TIME */}
            <div className="min-w-full">
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
                    setTimeout(() => setPanelIndex(3), 150)
                  }}
                />
              </div>
            </div>

            {/* Panel 3: BOAT + DURATION */}
            <div className="min-w-full">
              <div ref={bookingCardRef} className="border-2 border-[var(--color-primary)] rounded-2xl p-5 bg-white">
                <h3 className="font-avenir font-bold text-base text-[var(--color-ink)] mb-1">
                  Cruise details
                </h3>

                {props.cancellationPolicy && (
                  <div className="flex items-center gap-2 text-[var(--color-muted)] text-sm mb-4">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                    </svg>
                    <span>{props.cancellationPolicy.length > 40 ? 'Free cancellation' : props.cancellationPolicy}</span>
                  </div>
                )}

                {state.selectedSlot && (
                  <BoatDurationStep
                    customerTypes={state.selectedSlot.customerTypes}
                    guests={state.guests}
                    selectedCustomerTypePk={state.selectedCustomerType?.pk ?? null}
                    onSelect={(ct, boatId) => {
                      dispatch({ type: 'SELECT_BOAT_DURATION', customerType: ct, boatId })
                      setTimeout(() => setPanelIndex(4), 150)
                    }}
                  />
                )}

                {basePriceCents > 0 && (
                  <div className="mt-4 pt-4 border-t border-zinc-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-avenir font-bold text-base text-[var(--color-ink)]">Total</span>
                      <span className="font-avenir font-bold text-base text-[var(--color-ink)]">{fmtEuros(basePriceCents + cityTaxCents)}</span>
                    </div>
                    <p className="text-xs text-[var(--color-muted)]">Includes taxes and charges</p>
                  </div>
                )}
              </div>
            </div>

            {/* Panel 4: EXTRAS */}
            <div className="min-w-full">
              <div ref={extrasRef} className="space-y-4">
                <div className="border border-zinc-200 rounded-2xl p-5 bg-white">
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

                {basePriceCents > 0 && (
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
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── SHARED FLOW ───────────────────────────────────────────────────────────

  function SharedSlider() {
    const hasTime = !!state.selectedSlot
    const hasTickets = state.totalTickets > 0

    return (
      <div className="space-y-0">
        {/* Summary tabs */}
        <BookingSummaryTabs tabs={summaryTabs} currentPanel={panelIndex} onTabClick={handleTabClick} />

        {/* Sliding container */}
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${panelIndex * 100}%)` }}
          >
            {/* Panel 0: DATE + TIME + TICKETS (all together) */}
            <div className="min-w-full space-y-6">
              <DateCardPicker
                selectedDate={state.date}
                onSelectDate={handleInlineDateSelect}
              />

              {/* Time slots — shown after date selection */}
              {state.date && (
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

              {/* Ticket counters — shown after time selection */}
              {hasTime && state.selectedSlot && (
                <div ref={bookingCardRef} className="border-2 border-[var(--color-primary)] rounded-2xl p-5 bg-white">
                  <h3 className="font-avenir font-bold text-base text-[var(--color-ink)] mb-1">
                    Ticket
                  </h3>

                  {props.cancellationPolicy && (
                    <div className="flex items-center gap-2 text-[var(--color-muted)] text-sm mb-4">
                      <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                      </svg>
                      <span>{props.cancellationPolicy.length > 40 ? 'Free cancellation' : props.cancellationPolicy}</span>
                    </div>
                  )}

                  <TicketStep
                    customerTypes={state.selectedSlot.customerTypes}
                    ticketCounts={state.ticketCounts}
                    maxCapacity={state.selectedSlot.capacity}
                    onUpdateCount={(pk, count) => dispatch({ type: 'UPDATE_TICKET_COUNT', customerTypePk: pk, count })}
                    onConfirm={() => dispatch({ type: 'CONFIRM_TICKETS' })}
                  />

                  {basePriceCents > 0 && (
                    <div className="mt-4 pt-4 border-t border-zinc-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-avenir font-bold text-base text-[var(--color-ink)]">Total</span>
                        <span className="font-avenir font-bold text-base text-[var(--color-ink)]">{fmtEuros(basePriceCents + cityTaxCents)}</span>
                      </div>
                      <p className="text-xs text-[var(--color-muted)] mb-4">Includes taxes and charges</p>

                      <div className="flex justify-end">
                        <Button
                          variant="primary"
                          size="md"
                          className="rounded-xl font-bold px-10"
                          onClick={() => {
                            dispatch({ type: 'CONFIRM_TICKETS' })
                            setPanelIndex(1)
                          }}
                          disabled={!hasTickets}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel 1: EXTRAS */}
            <div className="min-w-full">
              <div ref={extrasRef} className="space-y-4">
                <div className="border border-zinc-200 rounded-2xl p-5 bg-white">
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

                {basePriceCents > 0 && (
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
            </div>
          </div>
        </div>
      </div>
    )
  }
}

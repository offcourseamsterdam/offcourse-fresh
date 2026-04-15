'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { getToday, toDateStr } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
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

// Slide direction: +1 = forward (slide left), -1 = backward (slide right)
const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '40%' : '-40%',
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? '-40%' : '40%',
    opacity: 0,
  }),
}

export function BookingPanelSlider(props: BookingPanelProps) {
  const {
    state, dispatch, category,
    timeSlotsRef, bookingCardRef, extrasRef,
    handleInlineDateSelect, handleExtrasChange, handleProceedToCheckout,
    fetchSlots,
    basePriceCents, guestCount, cityTaxCents, ticketBreakdown, boatSummary,
    dateSummary, guestsSummary, timeSummary, ticketSummary,
    listingId,
  } = useBookingPanel(props)

  // ── Panel index ──────────────────────────────────────────────────────────

  // Private: 0=date+guests, 1=time, 2=boat, 3=extras
  // Shared:  0=date+time, 1=tickets, 2=extras
  const [panelIndex, setPanelIndex] = useState(0)
  const [direction, setDirection] = useState(1)

  // Track whether extras panel has been visited (to keep it mounted)
  const hasVisitedExtras = useRef(false)
  const extrasPanelIndex = category === 'private' ? 3 : 2
  if (panelIndex === extrasPanelIndex) hasVisitedExtras.current = true

  // ── Summary tabs for completed steps ──────────────────────────────────────

  const summaryTabs = useMemo(() => {
    const tabs: { label: string; panelIndex: number }[] = []

    if (category === 'private') {
      if (panelIndex > 0 && dateSummary) tabs.push({ label: dateSummary, panelIndex: 0 })
      if (panelIndex > 0 && guestsSummary) tabs.push({ label: guestsSummary, panelIndex: 0 })
      if (panelIndex > 1 && timeSummary) tabs.push({ label: timeSummary, panelIndex: 1 })
      if (panelIndex > 2 && boatSummary) tabs.push({ label: boatSummary, panelIndex: 2 })
    } else {
      // Shared: 0=date+time, 1=tickets, 2=extras
      if (dateSummary) tabs.push({ label: dateSummary, panelIndex: 0 })
      if (timeSummary) tabs.push({ label: timeSummary, panelIndex: 0 })
      if (panelIndex > 1 && ticketSummary) tabs.push({ label: ticketSummary, panelIndex: 1 })
    }

    return tabs
  }, [category, panelIndex, dateSummary, guestsSummary, timeSummary, boatSummary, ticketSummary])

  // ── Navigation ────────────────────────────────────────────────────────────

  const goToPanel = useCallback((index: number) => {
    setDirection(index > panelIndex ? 1 : -1)
    setPanelIndex(index)
  }, [panelIndex])

  const handleTabClick = useCallback((targetPanel: number) => {
    goToPanel(targetPanel)
    if (category === 'private') {
      const stepMap = ['date', 'time', 'boat', 'extras'] as const
      dispatch({ type: 'REOPEN_STEP', step: stepMap[targetPanel] })
    } else {
      // Shared: 0=date+time, 1=tickets, 2=extras
      const sharedStepMap = ['date', 'tickets', 'extras'] as const
      dispatch({ type: 'REOPEN_STEP', step: sharedStepMap[targetPanel] })
    }
  }, [category, dispatch, goToPanel])

  // ── Suggest next date when fully booked ─────────────────────────────────────

  const suggestDate = useMemo(() => {
    if (!state.date) return undefined
    const selected = new Date(state.date + 'T12:00:00')
    const tomorrow = new Date(selected)
    tomorrow.setDate(selected.getDate() + 1)
    const today = getToday()
    const isToday = state.date === toDateStr(today)
    return {
      label: isToday ? 'tomorrow' : tomorrow.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }),
      dateStr: toDateStr(tomorrow),
    }
  }, [state.date])

  // ── Shared extras JSX (inlined, NOT a function component) ─────────────────

  const extrasVisible = panelIndex === extrasPanelIndex
  const extrasBlock = hasVisitedExtras.current && (
    <div ref={extrasRef} className={`space-y-4 ${extrasVisible ? '' : 'hidden'}`}>
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
  )

  // ── Render ────────────────────────────────────────────────────────────────

  // NOTE: Called as functions, NOT as JSX components (<PrivateSlider />).
  // Using JSX would create a component boundary — since these functions are
  // redefined every render, React would see a "new" component type each time
  // and unmount/remount the entire subtree, destroying all child state
  // (causing infinite "Loading extras..." and "Select time" reloading).
  if (category === 'private') {
    return PrivateSlider()
  }
  return SharedSlider()

  // ── PRIVATE FLOW ──────────────────────────────────────────────────────────

  function PrivateSlider() {
    return (
      <div>
        <BookingSummaryTabs tabs={summaryTabs} currentPanel={panelIndex} onTabClick={handleTabClick} />

        <AnimatePresence mode="wait" custom={direction}>
          {/* Panel 0: DATE + GUESTS */}
          {panelIndex === 0 && (
            <motion.div
              key="panel-date-guests"
              custom={direction}
              variants={slideVariants}
              initial={false}
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="space-y-5"
            >
              <DateCardPicker
                selectedDate={state.date}
                onSelectDate={handleInlineDateSelect}
              />

              <div>
                <p className="font-avenir font-semibold text-[15px] text-[var(--color-ink)] mb-2">How many guests?</p>
                <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
                  <span className="text-sm font-medium text-zinc-800">Guests</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'SET_GUESTS', guests: Math.max(1, state.guests - 1) })}
                      disabled={state.guests <= 1}
                      className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 transition-colors"
                    >
                      <span className="text-lg leading-none">−</span>
                    </button>
                    <span className="w-6 text-center font-semibold text-zinc-800 tabular-nums">{state.guests}</span>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'SET_GUESTS', guests: Math.min(12, state.guests + 1) })}
                      disabled={state.guests >= 12}
                      className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 transition-colors"
                    >
                      <span className="text-lg leading-none">+</span>
                    </button>
                  </div>
                </div>
              </div>

              {state.date && (
                <div className="flex justify-end">
                  <Button variant="primary" size="md" className="rounded-xl font-bold px-10" onClick={async () => {
                    dispatch({ type: 'SLOTS_LOADING' })
                    goToPanel(1)
                    if (state.date) {
                      await fetchSlots(state.date, state.guests)
                    }
                  }}>
                    Next
                  </Button>
                </div>
              )}
            </motion.div>
          )}

          {/* Panel 1: TIME */}
          {panelIndex === 1 && (
            <motion.div
              key="panel-time"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
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
                    goToPanel(2)
                  }}
                  suggestDate={suggestDate ? {
                    label: suggestDate.label,
                    onSelect: () => {
                      handleInlineDateSelect(suggestDate.dateStr)
                      goToPanel(0)
                    },
                  } : undefined}
                />
              </div>
            </motion.div>
          )}

          {/* Panel 2: BOAT + DURATION */}
          {panelIndex === 2 && (
            <motion.div
              key="panel-boat"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
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
                      goToPanel(3)
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Extras — kept mounted once visited, hidden when not on panel 3 */}
        {extrasBlock}
      </div>
    )
  }

  // ── SHARED FLOW (3 panels: date+time → tickets → extras) ──────────────────

  function SharedSlider() {
    const hasTickets = state.totalTickets > 0

    return (
      <div>
        <BookingSummaryTabs tabs={summaryTabs} currentPanel={panelIndex} onTabClick={handleTabClick} />

        <AnimatePresence mode="wait" custom={direction}>
          {/* Panel 0: DATE + TIME */}
          {panelIndex === 0 && (
            <motion.div
              key="shared-panel-0"
              custom={direction}
              variants={slideVariants}
              initial={false}
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="space-y-6"
            >
              <DateCardPicker
                selectedDate={state.date}
                onSelectDate={handleInlineDateSelect}
              />

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
                      goToPanel(1)
                    }}
                    suggestDate={suggestDate ? {
                      label: suggestDate.label,
                      onSelect: () => handleInlineDateSelect(suggestDate.dateStr),
                    } : undefined}
                  />
                </div>
              )}
            </motion.div>
          )}

          {/* Panel 1: TICKETS */}
          {panelIndex === 1 && (
            <motion.div
              key="shared-panel-1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {state.selectedSlot && (
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
                            goToPanel(2)
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Extras — kept mounted once visited, hidden when not on panel 2 */}
        {extrasBlock}
      </div>
    )
  }
}

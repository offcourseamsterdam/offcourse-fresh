'use client'

import { useReducer, useCallback, useEffect, useRef } from 'react'
import type { AvailabilitySlot } from '@/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'
import { formatDuration, fmtEuros } from '@/lib/utils'
import { trackEvent } from '@/lib/tracking/client'
import { reducer, initialState, type BookingPanelProps, type Step } from './booking-state'

export function useBookingPanel({
  listingId,
  listingSlug,
  listingTitle,
  listingHeroImageUrl,
  category,
  initialDate = '',
  initialGuests = 2,
  initialTime,
}: BookingPanelProps) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    guests: initialGuests,
    date: initialDate || null,
  })

  const hasAutoAdvanced = useRef(false)
  const timeSlotsRef = useRef<HTMLDivElement>(null)
  const bookingCardRef = useRef<HTMLDivElement>(null)
  const extrasRef = useRef<HTMLDivElement>(null)

  // ── Fetch slots ─────────────────────────────────────────────────────────

  const fetchSlots = useCallback(async (date: string, guests: number): Promise<AvailabilitySlot[]> => {
    try {
      const params = new URLSearchParams({ date, guests: String(guests), slug: listingSlug })
      const res = await fetch(`/api/search/slots?${params}`)
      const json = await res.json()
      const slots = json.data?.slots ?? []
      dispatch({ type: 'SLOTS_LOADED', slots })
      if (slots.length === 0) {
        trackEvent('no_availability', { date, listing: listingSlug })
      }
      return slots
    } catch {
      dispatch({ type: 'SLOTS_LOADED', slots: [] })
      return []
    }
  }, [listingSlug])

  // ── Auto-advance from search results ────────────────────────────────────

  useEffect(() => {
    if (hasAutoAdvanced.current || !initialDate || !initialTime) return
    hasAutoAdvanced.current = true

    async function autoAdvance() {
      dispatch({ type: 'SET_DATE', date: initialDate, guests: initialGuests, category })
      const slots = await fetchSlots(initialDate, initialGuests)
      const match = slots.find(s => s.startTime === initialTime)
      if (match) dispatch({ type: 'SELECT_SLOT', slot: match, category })
    }

    autoAdvance()
  }, [initialDate, initialTime, initialGuests, category, fetchSlots])

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleDateConfirm = useCallback(async (date: string, guests: number) => {
    trackEvent('select_date', { date, guests: String(guests), category })
    dispatch({ type: 'SET_DATE', date, guests, category })
    if (category === 'shared') {
      await fetchSlots(date, guests)
    }
  }, [category, fetchSlots])

  const handleGuestsConfirm = useCallback(async (guests: number) => {
    dispatch({ type: 'CONFIRM_GUESTS', guests })
    if (state.date) {
      await fetchSlots(state.date, guests)
    }
  }, [state.date, fetchSlots])

  const handleExtrasChange = useCallback((ids: string[], calc: ExtrasCalculation) => {
    const extraQuantities = Object.fromEntries(calc.line_items.map(li => [li.extra_id, li.quantity]))
    dispatch({ type: 'UPDATE_EXTRAS', selectedExtraIds: ids, calculation: calc, extraQuantities })
  }, [])

  const handleInlineDateSelect = useCallback(async (date: string) => {
    dispatch({ type: 'SET_DATE', date, guests: category === 'shared' ? 1 : state.guests, category })
    dispatch({ type: 'SLOTS_LOADING' })
    if (category === 'shared') {
      await fetchSlots(date, 1)
    } else {
      await fetchSlots(date, state.guests)
    }
    setTimeout(() => timeSlotsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
  }, [category, state.guests, fetchSlots])

  const handleInlineGuestChange = useCallback(async (guests: number) => {
    dispatch({ type: 'CONFIRM_GUESTS', guests })
    if (state.date) {
      await fetchSlots(state.date, guests)
    }
  }, [state.date, fetchSlots])

  // ── Step helpers ────────────────────────────────────────────────────────

  const steps: Step[] = category === 'private'
    ? ['date', 'guests', 'time', 'boat', 'extras']
    : ['date', 'time', 'tickets', 'extras']

  const currentStepIndex = steps.indexOf(state.step)
  const isStepCompleted = (step: Step) => steps.indexOf(step) < currentStepIndex
  const isStepActive = (step: Step) => state.step === step
  const stepNumber = (step: Step) => steps.indexOf(step) + 1

  // ── Derived values ──────────────────────────────────────────────────────

  const dateSummary = state.date
    ? new Date(state.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      })
    : undefined

  const guestsSummary = state.guests > 0
    ? `${state.guests} ${state.guests === 1 ? 'guest' : 'guests'}`
    : undefined

  const timeSummary = state.selectedSlot?.startTime

  const boatSummary = state.selectedBoat && state.selectedCustomerType
    ? `${state.selectedBoat === 'diana' ? 'Diana' : 'Curaçao'} · ${formatDuration(state.selectedCustomerType.durationMinutes)}`
    : undefined

  const ticketSummary = state.totalTickets > 0
    ? `${state.totalTickets} ${state.totalTickets === 1 ? 'ticket' : 'tickets'}`
    : undefined

  let basePriceCents = 0
  if (category === 'private' && state.selectedCustomerType) {
    basePriceCents = state.selectedCustomerType.priceCents
  } else if (category === 'shared' && state.selectedSlot) {
    basePriceCents = state.selectedSlot.customerTypes.reduce(
      (sum, ct) => sum + (state.ticketCounts[ct.customerTypePk] || 0) * ct.priceCents,
      0
    )
  }

  const guestCount = category === 'private' ? state.guests : state.totalTickets
  const cityTaxCents = category === 'shared' ? state.totalTickets * 260 : 0

  const ticketBreakdown = category === 'shared' && state.selectedSlot
    ? state.selectedSlot.customerTypes
        .filter(ct => (state.ticketCounts[ct.customerTypePk] || 0) > 0)
        .map((ct, i) => ({
          label: i === 0 ? 'Adult' : 'Child',
          count: state.ticketCounts[ct.customerTypePk] || 0,
          priceCents: ct.priceCents,
        }))
    : undefined

  // ── Track step transitions ─────────────────────────────────────────────
  useEffect(() => {
    if (state.step === 'extras') trackEvent('view_extras', { listing: listingSlug })
    if (state.step === 'boat') trackEvent('view_boat', { listing: listingSlug })
    if (state.step === 'tickets') trackEvent('view_tickets', { listing: listingSlug })
  }, [state.step, listingSlug])

  // Track time slot selection
  const prevSlotRef = useRef<number | null>(null)
  useEffect(() => {
    if (state.selectedSlot && state.selectedSlot.pk !== prevSlotRef.current) {
      prevSlotRef.current = state.selectedSlot.pk
      trackEvent('select_time', { listing: listingSlug, time: state.selectedSlot.startTime })
    }
  }, [state.selectedSlot, listingSlug])

  // ── Checkout ────────────────────────────────────────────────────────────

  function handleProceedToCheckout() {
    const bookingData = {
      listingId, listingSlug, listingTitle, listingHeroImageUrl, category,
      date: state.date, guests: guestCount,
      selectedSlot: state.selectedSlot, selectedBoat: state.selectedBoat,
      selectedCustomerType: state.selectedCustomerType,
      ticketCounts: state.ticketCounts, totalTickets: state.totalTickets,
      selectedExtraIds: state.selectedExtraIds, extrasCalculation: state.extrasCalculation,
      extraQuantities: state.extraQuantities,
      basePriceCents, cityTaxCents,
    }
    sessionStorage.setItem('offcourse_booking', JSON.stringify(bookingData))

    const params = new URLSearchParams({
      slug: listingSlug,
      date: state.date || '',
      guests: String(guestCount),
    })
    window.location.href = `/book/${listingSlug}/checkout?${params}`
  }

  return {
    state, dispatch, category,
    // Refs
    timeSlotsRef, bookingCardRef, extrasRef,
    // Handlers
    fetchSlots, handleDateConfirm, handleGuestsConfirm, handleExtrasChange,
    handleInlineDateSelect, handleInlineGuestChange, handleProceedToCheckout,
    // Step helpers
    steps, isStepCompleted, isStepActive, stepNumber,
    // Summaries
    dateSummary, guestsSummary, timeSummary, boatSummary, ticketSummary,
    // Derived
    basePriceCents, guestCount, cityTaxCents, ticketBreakdown,
    // Props pass-through
    listingId, listingSlug,
  }
}

export type UseBookingPanel = ReturnType<typeof useBookingPanel>

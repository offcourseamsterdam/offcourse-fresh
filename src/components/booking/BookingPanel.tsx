'use client'

import { useReducer, useCallback, useEffect, useRef } from 'react'
import type { AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'
import { StepAccordion } from './StepAccordion'
import { DateStep } from './DateStep'
import { GuestStep } from './GuestStep'
import { TimeSlotStep } from './TimeSlotStep'
import { BoatDurationStep } from './BoatDurationStep'
import { TicketStep } from './TicketStep'
import { ExtrasStep } from './ExtrasStep'
import { PriceSummary } from './PriceSummary'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'date' | 'guests' | 'time' | 'boat' | 'tickets' | 'extras'

interface BookingPanelState {
  step: Step
  date: string | null
  guests: number
  slots: AvailabilitySlot[]
  loadingSlots: boolean
  selectedSlot: AvailabilitySlot | null
  // Private tour state
  selectedBoat: string | null
  selectedCustomerType: AvailabilityCustomerType | null
  // Shared tour state
  ticketCounts: Record<number, number>
  totalTickets: number
  // Extras
  selectedExtraIds: string[]
  extrasCalculation: ExtrasCalculation | null
}

type Action =
  | { type: 'SET_DATE'; date: string; guests: number; category: 'private' | 'shared' }
  | { type: 'CONFIRM_GUESTS'; guests: number }
  | { type: 'SLOTS_LOADING' }
  | { type: 'SLOTS_LOADED'; slots: AvailabilitySlot[] }
  | { type: 'SELECT_SLOT'; slot: AvailabilitySlot }
  | { type: 'SELECT_BOAT_DURATION'; customerType: AvailabilityCustomerType; boatId: string }
  | { type: 'UPDATE_TICKET_COUNT'; customerTypePk: number; count: number }
  | { type: 'CONFIRM_TICKETS' }
  | { type: 'UPDATE_EXTRAS'; selectedExtraIds: string[]; calculation: ExtrasCalculation }
  | { type: 'REOPEN_STEP'; step: Step }

function reducer(state: BookingPanelState, action: Action): BookingPanelState {
  switch (action.type) {
    case 'SET_DATE':
      return {
        ...state,
        date: action.date,
        guests: action.guests,
        // Private: go to guests step. Shared: go straight to time (slots fetched externally).
        step: action.category === 'private' ? 'guests' : 'time',
        loadingSlots: action.category === 'shared',
        slots: [],
        selectedSlot: null,
        selectedBoat: null,
        selectedCustomerType: null,
        ticketCounts: {},
        totalTickets: 0,
        selectedExtraIds: [],
        extrasCalculation: null,
      }
    case 'CONFIRM_GUESTS':
      return {
        ...state,
        guests: action.guests,
        step: 'time',
        loadingSlots: true,
        slots: [],
        selectedSlot: null,
        selectedBoat: null,
        selectedCustomerType: null,
      }
    case 'SLOTS_LOADING':
      return { ...state, loadingSlots: true }
    case 'SLOTS_LOADED':
      return { ...state, loadingSlots: false, slots: action.slots }
    case 'SELECT_SLOT':
      return {
        ...state,
        selectedSlot: action.slot,
        step: 'boat', // works for both modes — BookingPanel renders the right step
        selectedBoat: null,
        selectedCustomerType: null,
        ticketCounts: {},
        totalTickets: 0,
      }
    case 'SELECT_BOAT_DURATION':
      return {
        ...state,
        selectedBoat: action.boatId,
        selectedCustomerType: action.customerType,
        step: 'extras',
      }
    case 'UPDATE_TICKET_COUNT': {
      const newCounts = { ...state.ticketCounts, [action.customerTypePk]: action.count }
      if (action.count === 0) delete newCounts[action.customerTypePk]
      const total = Object.values(newCounts).reduce((s, c) => s + c, 0)
      return { ...state, ticketCounts: newCounts, totalTickets: total }
    }
    case 'CONFIRM_TICKETS':
      return { ...state, step: 'extras' }
    case 'UPDATE_EXTRAS':
      return {
        ...state,
        selectedExtraIds: action.selectedExtraIds,
        extrasCalculation: action.calculation,
      }
    case 'REOPEN_STEP':
      return { ...state, step: action.step }
    default:
      return state
  }
}

const initialState: BookingPanelState = {
  step: 'date',
  date: null,
  guests: 2,
  slots: [],
  loadingSlots: false,
  selectedSlot: null,
  selectedBoat: null,
  selectedCustomerType: null,
  ticketCounts: {},
  totalTickets: 0,
  selectedExtraIds: [],
  extrasCalculation: null,
}

// ── Props ────────────────────────────────────────────────────────────────────

interface BookingPanelProps {
  listingId: string
  listingSlug: string
  listingTitle: string
  listingHeroImageUrl: string | null
  category: 'private' | 'shared'
  initialDate?: string
  initialGuests?: number
  /** Pre-selected time from search results (e.g. "10:00") — auto-advances past date/time steps */
  initialTime?: string
}

// ── Component ────────────────────────────────────────────────────────────────

export function BookingPanel({
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

  // Fetch slots for a given date + guest count. Returns the slots array.
  const fetchSlots = useCallback(async (date: string, guests: number): Promise<AvailabilitySlot[]> => {
    try {
      const params = new URLSearchParams({ date, guests: String(guests), slug: listingSlug })
      const res = await fetch(`/api/search/slots?${params}`)
      const json = await res.json()
      const slots = json.data?.slots ?? []
      dispatch({ type: 'SLOTS_LOADED', slots })
      return slots
    } catch {
      dispatch({ type: 'SLOTS_LOADED', slots: [] })
      return []
    }
  }, [listingSlug])

  // Auto-advance: when arriving from a search result with a pre-selected time,
  // skip the date step, fetch slots, and auto-select the matching timeslot
  useEffect(() => {
    if (hasAutoAdvanced.current || !initialDate || !initialTime) return
    hasAutoAdvanced.current = true

    async function autoAdvance() {
      dispatch({ type: 'SET_DATE', date: initialDate, guests: initialGuests, category })
      const slots = await fetchSlots(initialDate, initialGuests)
      const match = slots.find(s => s.startTime === initialTime)
      if (match) dispatch({ type: 'SELECT_SLOT', slot: match })
    }

    autoAdvance()
  }, [initialDate, initialTime, initialGuests, category, fetchSlots])

  // Date confirmed — for shared, also fetch slots immediately
  const handleDateConfirm = useCallback(async (date: string, guests: number) => {
    dispatch({ type: 'SET_DATE', date, guests, category })
    if (category === 'shared') {
      await fetchSlots(date, guests)
    }
  }, [category, fetchSlots])

  // Guests confirmed (private only) — now fetch slots
  const handleGuestsConfirm = useCallback(async (guests: number) => {
    dispatch({ type: 'CONFIRM_GUESTS', guests })
    if (state.date) {
      await fetchSlots(state.date, guests)
    }
  }, [state.date, fetchSlots])

  // Extras selection changed — update price summary in real time
  const handleExtrasChange = useCallback((ids: string[], calc: ExtrasCalculation) => {
    dispatch({ type: 'UPDATE_EXTRAS', selectedExtraIds: ids, calculation: calc })
  }, [])

  // Helpers for step ordering
  const steps: Step[] = category === 'private'
    ? ['date', 'guests', 'time', 'boat', 'extras']
    : ['date', 'time', 'tickets', 'extras']

  const currentStepIndex = steps.indexOf(state.step)
  const isStepCompleted = (step: Step) => steps.indexOf(step) < currentStepIndex
  const isStepActive = (step: Step) => state.step === step

  // Dynamic step numbering (accounts for guests step in private mode)
  const stepNumber = (step: Step) => steps.indexOf(step) + 1

  // Format date for summary
  const dateSummary = state.date
    ? new Date(state.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      })
    : undefined

  const guestsSummary = state.guests > 0 && isStepCompleted('guests')
    ? `${state.guests} ${state.guests === 1 ? 'guest' : 'guests'}`
    : undefined

  const timeSummary = state.selectedSlot?.startTime

  const boatSummary = state.selectedBoat && state.selectedCustomerType
    ? `${state.selectedBoat === 'diana' ? 'Diana' : 'Curaçao'} · ${formatDuration(state.selectedCustomerType.durationMinutes)}`
    : undefined

  const ticketSummary = state.totalTickets > 0
    ? `${state.totalTickets} ${state.totalTickets === 1 ? 'ticket' : 'tickets'}`
    : undefined

  // Calculate base price for PriceSummary
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

  // Ticket breakdown for PriceSummary
  const ticketBreakdown = category === 'shared' && state.selectedSlot
    ? state.selectedSlot.customerTypes
        .filter(ct => (state.ticketCounts[ct.customerTypePk] || 0) > 0)
        .map((ct, i) => ({
          label: i === 0 ? 'Adult' : 'Child',
          count: state.ticketCounts[ct.customerTypePk] || 0,
          priceCents: ct.priceCents,
        }))
    : undefined

  // Handle proceed to checkout
  function handleProceedToCheckout() {
    // Serialize booking state to sessionStorage for checkout page
    const bookingData = {
      listingId,
      listingSlug,
      listingTitle,
      listingHeroImageUrl,
      category,
      date: state.date,
      guests: guestCount,
      selectedSlot: state.selectedSlot,
      selectedBoat: state.selectedBoat,
      selectedCustomerType: state.selectedCustomerType,
      ticketCounts: state.ticketCounts,
      totalTickets: state.totalTickets,
      selectedExtraIds: state.selectedExtraIds,
      extrasCalculation: state.extrasCalculation,
      basePriceCents,
    }
    sessionStorage.setItem('offcourse_booking', JSON.stringify(bookingData))

    // Navigate to checkout
    const params = new URLSearchParams({
      slug: listingSlug,
      date: state.date || '',
      guests: String(guestCount),
    })
    window.location.href = `/book/${listingSlug}/checkout?${params}`
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-zinc-100 p-5">
      <h3 className="font-bold text-[var(--color-primary)] text-base mb-4">Book this cruise</h3>

      {/* Step 1: Date */}
      <StepAccordion
        title="Pick a date"
        summary={dateSummary}
        stepNumber={stepNumber('date')}
        isActive={isStepActive('date')}
        isCompleted={isStepCompleted('date')}
        onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'date' })}
      >
        <DateStep
          mode={category}
          initialDate={state.date || undefined}
          initialGuests={state.guests}
          onConfirm={handleDateConfirm}
        />
      </StepAccordion>

      {/* Step 2: Guests (Private only) */}
      {category === 'private' && (
        <StepAccordion
          title="How many guests?"
          summary={guestsSummary}
          stepNumber={stepNumber('guests')}
          isActive={isStepActive('guests')}
          isCompleted={isStepCompleted('guests')}
          onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'guests' })}
        >
          <GuestStep
            initialGuests={state.guests}
            maxGuests={12}
            onConfirm={handleGuestsConfirm}
          />
        </StepAccordion>
      )}

      {/* Pick a time */}
      <StepAccordion
        title="Pick a time"
        summary={timeSummary}
        stepNumber={stepNumber('time')}
        isActive={isStepActive('time')}
        isCompleted={isStepCompleted('time')}
        onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'time' })}
      >
        <TimeSlotStep
          slots={state.slots}
          loading={state.loadingSlots}
          mode={category}
          selectedSlotPk={state.selectedSlot?.pk ?? null}
          onSelect={(slot) => dispatch({ type: 'SELECT_SLOT', slot })}
        />
      </StepAccordion>

      {/* Boat + Duration (Private) */}
      {category === 'private' && (
        <StepAccordion
          title="Choose your boat"
          summary={boatSummary}
          stepNumber={stepNumber('boat')}
          isActive={isStepActive('boat')}
          isCompleted={isStepCompleted('boat')}
          onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'boat' })}
        >
          {state.selectedSlot && (
            <BoatDurationStep
              customerTypes={state.selectedSlot.customerTypes}
              guests={state.guests}
              selectedCustomerTypePk={state.selectedCustomerType?.pk ?? null}
              onSelect={(ct, boatId) => dispatch({ type: 'SELECT_BOAT_DURATION', customerType: ct, boatId })}
            />
          )}
        </StepAccordion>
      )}

      {/* Tickets (Shared) */}
      {category === 'shared' && (
        <StepAccordion
          title="Select tickets"
          summary={ticketSummary}
          stepNumber={stepNumber('tickets')}
          isActive={isStepActive('tickets')}
          isCompleted={isStepCompleted('tickets')}
          onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'tickets' })}
        >
          {state.selectedSlot && (
            <TicketStep
              customerTypes={state.selectedSlot.customerTypes}
              ticketCounts={state.ticketCounts}
              maxCapacity={state.selectedSlot.capacity}
              onUpdateCount={(pk, count) => dispatch({ type: 'UPDATE_TICKET_COUNT', customerTypePk: pk, count })}
              onConfirm={() => dispatch({ type: 'CONFIRM_TICKETS' })}
            />
          )}
        </StepAccordion>
      )}

      {/* Extras */}
      <StepAccordion
        title="Add food, drinks & extras"
        summary={state.selectedExtraIds.length > 0 ? `${state.selectedExtraIds.length} extras selected` : undefined}
        stepNumber={stepNumber('extras')}
        isActive={isStepActive('extras')}
        isCompleted={isStepCompleted('extras')}
        onReopen={() => dispatch({ type: 'REOPEN_STEP', step: 'extras' })}
      >
        <ExtrasStep
          listingId={listingId}
          guestCount={guestCount}
          baseAmountCents={basePriceCents}
          durationMinutes={state.selectedCustomerType?.durationMinutes ?? state.selectedSlot?.customerTypes[0]?.durationMinutes}
          onExtrasChange={handleExtrasChange}
        />
      </StepAccordion>

      {/* Price Summary — always visible when we have a price */}
      {basePriceCents > 0 && (
        <PriceSummary
          basePriceCents={basePriceCents}
          extrasCalculation={state.extrasCalculation}
          mode={category}
          cruiseLabel={boatSummary}
          ticketBreakdown={ticketBreakdown}
        />
      )}

      {/* Proceed to booking CTA — visible once extras step is reached */}
      {state.step === 'extras' && (
        <div className="mt-5">
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

import type { AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

// ── Step types ──────────────────────────────────────────────────────────────

export type Step = 'date' | 'guests' | 'time' | 'boat' | 'tickets' | 'extras'

export interface BookingPanelState {
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

export type Action =
  | { type: 'SET_DATE'; date: string; guests: number; category: 'private' | 'shared' }
  | { type: 'CONFIRM_GUESTS'; guests: number }
  | { type: 'SLOTS_LOADING' }
  | { type: 'SLOTS_LOADED'; slots: AvailabilitySlot[] }
  | { type: 'SELECT_SLOT'; slot: AvailabilitySlot; category: 'private' | 'shared' }
  | { type: 'SELECT_BOAT_DURATION'; customerType: AvailabilityCustomerType; boatId: string }
  | { type: 'UPDATE_TICKET_COUNT'; customerTypePk: number; count: number }
  | { type: 'CONFIRM_TICKETS' }
  | { type: 'UPDATE_EXTRAS'; selectedExtraIds: string[]; calculation: ExtrasCalculation }
  | { type: 'REOPEN_STEP'; step: Step }

// ── Reducer ─────────────────────────────────────────────────────────────────

export function reducer(state: BookingPanelState, action: Action): BookingPanelState {
  switch (action.type) {
    case 'SET_DATE':
      return {
        ...state,
        date: action.date,
        guests: action.guests,
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
        step: action.category === 'private' ? 'boat' : 'tickets',
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

export const initialState: BookingPanelState = {
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

// ── Props ───────────────────────────────────────────────────────────────────

export interface InfoPill {
  icon: 'duration' | 'guests' | 'category'
  label: string
}

export interface BookingPanelProps {
  listingId: string
  listingSlug: string
  listingTitle: string
  listingHeroImageUrl: string | null
  category: 'private' | 'shared'
  initialDate?: string
  initialGuests?: number
  initialTime?: string
  infoPills?: InfoPill[]
  layout?: 'sidebar' | 'inline'
  cancellationPolicy?: string | null
}

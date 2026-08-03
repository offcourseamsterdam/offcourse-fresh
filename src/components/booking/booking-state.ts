import type { AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'
import type { CancellationTier } from '@/lib/cancellation/policy'

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
  extraQuantities: Record<string, number>
}

export type Action =
  | { type: 'SET_DATE'; date: string; guests: number; category: 'private' | 'shared' }
  | { type: 'SET_GUESTS'; guests: number }
  | { type: 'CONFIRM_GUESTS'; guests: number }
  | { type: 'SLOTS_LOADING' }
  | { type: 'SLOTS_LOADED'; slots: AvailabilitySlot[] }
  | { type: 'SELECT_SLOT'; slot: AvailabilitySlot; category: 'private' | 'shared' }
  | { type: 'SELECT_BOAT_DURATION'; customerType: AvailabilityCustomerType; boatId: string }
  | { type: 'UPDATE_TICKET_COUNT'; customerTypePk: number; count: number }
  | { type: 'CONFIRM_TICKETS' }
  | { type: 'UPDATE_EXTRAS'; selectedExtraIds: string[]; calculation: ExtrasCalculation; extraQuantities: Record<string, number> }
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
    case 'SET_GUESTS':
      return { ...state, guests: action.guests }
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
        extraQuantities: action.extraQuantities,
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
  extraQuantities: {},
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
  /** Tiered cancellation policy from the parent FH item — drives the live cutoff line. */
  cancellationTiers?: CancellationTier[] | null
  /** Starting price in whole euros (e.g. 35 = €35). Used for "starting from" display. */
  startingPrice?: number | null
  /** Optional header content rendered at the top of the sticky time card (desktop sidebar only). */
  sidebarHeader?: React.ReactNode
  /**
   * Maximum guests for this listing (from cruise_listings.max_guests).
   * Used to detect whether a shared slot already has other bookings:
   * if slot.capacity < maxGuests, the cruise is already "happening" and
   * we don't enforce the FareHarbor minimum party size gate.
   */
  maxGuests?: number | null
  /**
   * Boat ids ('diana' | 'curacao') this listing actually offers, derived from
   * `cruise_listings.allowed_customer_type_pks` matched against `boats.fareharbor_customer_type_pks`.
   * When set, BoatDurationStep omits cards for boats outside this list entirely
   * (vs. "sold out") — for listings like a single-boat special event where the
   * other boat was never part of the offering, not just unavailable today.
   * Undefined/empty means "show every boat", preserving existing behavior.
   */
  offeredBoatIds?: string[]
  /**
   * Pride-only styling: drives the rainbow gradient treatment across the whole
   * booking flow — the boat card's texture, the selected time slot, the fixed
   * event-date card's border, and the mobile sticky CTA's fill.
   */
  rainbowBoatCard?: boolean
  /**
   * Special events only have real availability on one scheduled day (YYYY-MM-DD).
   * When set, the date picker shows just that single day instead of a 14-day
   * scroller + calendar — there's nothing else to pick.
   */
  fixedDate?: string
  /**
   * Overrides the default floor of 2 guests we enforce on an empty shared
   * slot (see `minParty` in BookingPanelDesktop/BookingPanelSlider). From
   * `cruise_listings.availability_filters.min_guests_override` — e.g. 1 for
   * a listing where solo bookings should be allowed (Pride Amsterdam 2026).
   * Undefined/null keeps the existing floor-of-2 behavior.
   */
  minPartyOverride?: number | null
}

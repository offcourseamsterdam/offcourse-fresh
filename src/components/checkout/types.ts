import type { AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

/** Booking data shape persisted to sessionStorage across the checkout flow. */
export interface BookingData {
  listingId: string
  listingSlug: string
  listingTitle: string
  listingHeroImageUrl: string | null
  category: 'private' | 'shared'
  date: string
  guests: number
  selectedSlot: AvailabilitySlot
  selectedBoat: string | null
  selectedCustomerType: AvailabilityCustomerType | null
  ticketCounts: Record<number, number>
  totalTickets: number
  selectedExtraIds: string[]
  extrasCalculation: ExtrasCalculation | null
  extraQuantities: Record<string, number>
  basePriceCents: number
  cityTaxCents: number
  durationMinutes?: number
}

/** Server-canonical quote response from /api/booking-flow/quote */
export interface ServerQuote {
  quoteId: string
  expiresAt: string
  basePriceCents: number
  serverBaseAmountCents: number
  extrasCalculation: ExtrasCalculation
  cityTaxCents: number
  discountAmountCents: number
  totalCents: number
  durationMinutes: number
}

export interface PromoResult {
  promoCodeId: string
  label: string
  discountType: 'percentage' | 'fixed_amount' | 'full'
  discountAmountCents: number
  newTotalCents: number
  isFull: boolean
}

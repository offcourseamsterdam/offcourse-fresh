// Shared TypeScript types for the admin environment.
// These mirror the columns returned by /api/admin/* routes.

export interface AdminExtraLineItem {
  name: string
  amount_cents: number
  category?: string
  extra_id?: string
  quantity?: number
}

export interface AdminBooking {
  id: string
  created_at: string
  booking_uuid: string | null
  listing_id: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  tour_item_name: string | null
  listing_title: string | null
  start_time: string | null
  end_time: string | null
  booking_date: string | null
  guest_count: number | null
  category: string | null
  stripe_payment_intent_id: string | null
  stripe_amount: number | null
  status: string | null
  guest_note: string | null
  booking_source: string | null
  deposit_amount_cents: number | null
  extras_selected: AdminExtraLineItem[] | null
  base_amount_cents: number | null
  extras_amount_cents: number | null
  base_vat_amount_cents: number | null
  extras_vat_amount_cents: number | null
  total_vat_amount_cents: number | null
  catering_email_sent_at: string | null
}

export interface AdminPromoCode {
  id: string
  code: string
  label: string
  discount_type: 'percentage' | 'fixed_amount' | 'full'
  discount_value: number | null
  fixed_discount_cents: number | null
  max_uses: number | null
  uses_count: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  notes: string | null
  created_at: string
}

export interface AdminPartner {
  id: string
  name: string
  email: string | null
  is_active: boolean
  active_links?: number
  total_clicks?: number
  total_bookings?: number
  revenue_eur?: number
  commission_eur?: number
}

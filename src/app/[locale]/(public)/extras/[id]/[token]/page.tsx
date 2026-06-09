import { notFound } from 'next/navigation'
import { isValidExtrasToken } from '@/lib/booking/extras-token'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterCateringItems, type ExtrasLineItem } from '@/lib/catering/filter'
import { formatAmsterdamTime } from '@/lib/utils'
import ExtrasUpsellClient, { type UpsellExtra } from './ExtrasUpsellClient'

export const revalidate = 0

interface Props {
  params: Promise<{ locale: string; id: string; token: string }>
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Europe/Amsterdam',
  })
}

export default async function ExtrasUpsellPage({ params }: Props) {
  const { id, token } = await params

  if (!isValidExtrasToken(token, id)) notFound()

  const supabase = createAdminClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, customer_name, listing_title, listing_id, booking_date, start_time, end_time, guest_count, category, status, extras_selected, guest_note')
    .eq('id', id)
    .maybeSingle()

  if (!booking) notFound()
  if (!['confirmed', 'booked'].includes(booking.status ?? '')) notFound()

  const cruiseDate = new Date((booking.booking_date ?? '') + 'T12:00:00')
  if (cruiseDate < new Date(new Date().toDateString())) notFound()

  const existingExtras = (booking.extras_selected ?? []) as unknown as ExtrasLineItem[]
  const alreadyOrdered = existingExtras.some(e => e.source === 'extras_upsell')
  const existingCatering = existingExtras.filter(e => e.source === 'extras_upsell').map(e => ({
    name: e.name,
    quantity: e.quantity,
    is_per_person_pick: e.is_per_person_pick,
  }))

  // Fetch available food + drinks extras for this booking's listing
  const { data: allExtras } = await supabase
    .from('extras')
    .select('id, name, description, image_url, category, price_type, price_value, vat_rate, quantity_mode, min_quantity, min_people, adults_only, is_required, sort_order, applicable_categories, scope, ingredients')
    .eq('is_active', true)
    .in('category', ['food', 'drinks'])
    .order('sort_order', { ascending: true })

  const { data: listingExtraIds } = booking.listing_id
    ? await supabase.from('listing_extras').select('extra_id').eq('listing_id', booking.listing_id).eq('is_enabled', true)
    : { data: [] }
  const perListingIds = new Set((listingExtraIds ?? []).map(r => r.extra_id))

  const availableExtras = (allExtras ?? []).filter(e => {
    if (e.scope === 'per_listing') return perListingIds.has(e.id)
    const cats = e.applicable_categories as string[] | null
    return !cats || cats.includes('private') || cats.includes(booking.category ?? '')
  }) as UpsellExtra[]

  const startTimeStr = booking.start_time ? formatAmsterdamTime(booking.start_time) : ''
  const dateStr = booking.booking_date ? formatDate(booking.booking_date) : ''

  let durationStr = ''
  if (booking.start_time && booking.end_time) {
    const mins = Math.round((new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()) / 60000)
    if (mins > 0) {
      durationStr = mins === 90 ? '1.5 hrs' : mins % 60 === 0 ? `${mins / 60} hrs` : `${Math.floor(mins / 60)}h ${mins % 60}min`
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f1ec]">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">

        {/* Booking summary card */}
        <div className="bg-[var(--color-primary)] text-white rounded-2xl p-6 mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-1">Your cruise</p>
          <h1 className="text-xl font-bold mb-3">{booking.listing_title ?? 'Canal cruise'}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/80">
            {dateStr && <span>📅 {dateStr}</span>}
            {startTimeStr && <span>🕐 {startTimeStr}</span>}
            {durationStr && <span>⏱️ {durationStr}</span>}
            <span>👥 {booking.guest_count} guest{(booking.guest_count ?? 0) === 1 ? '' : 's'}</span>
          </div>
        </div>

        {/* Heading */}
        {!alreadyOrdered && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[var(--color-ink)] mb-2">
              Want to add food or drinks?
            </h2>
            <p className="text-[var(--color-muted)] text-sm leading-relaxed">
              Pick what you'd like and we'll have it ready on the boat. No payment needed now — you settle on the day.
            </p>
          </div>
        )}

        {/* Extras selection or confirmed order */}
        <ExtrasUpsellClient
          bookingId={booking.id}
          token={token}
          extras={availableExtras}
          guestCount={booking.guest_count ?? 2}
          alreadyOrdered={alreadyOrdered}
          existingCatering={existingCatering}
        />

      </div>
    </div>
  )
}

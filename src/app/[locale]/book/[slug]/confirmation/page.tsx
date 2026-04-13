import { createServiceClient } from '@/lib/supabase/server'
import { Check, Calendar, Mail, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface Props {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ payment_intent?: string }>
}

export const metadata = {
  title: 'Booking Confirmed — Off Course Amsterdam',
}

export default async function ConfirmationPage({ params, searchParams }: Props) {
  const { locale, slug } = await params
  const { payment_intent } = await searchParams

  let booking = null

  if (payment_intent) {
    const supabase = await createServiceClient()
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .eq('stripe_payment_intent_id', payment_intent)
      .single()
    booking = data
  }

  // Format time for display
  const startTime = booking?.start_time
    ? new Date(booking.start_time).toLocaleTimeString('nl-NL', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam'
      })
    : null

  const bookingDate = booking?.booking_date
    ? new Date(booking.booking_date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      })
    : null

  // Generate Google Calendar link
  const calendarUrl = booking?.start_time && booking?.end_time
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(booking.listing_title || 'Off Course Amsterdam')}&dates=${booking.start_time.replace(/[-:]/g, '').replace('.000', '')}/${booking.end_time.replace(/[-:]/g, '').replace('.000', '')}&details=${encodeURIComponent('Your canal cruise with Off Course Amsterdam. Meeting point: Brouwersgracht 29. Look for the big pier/jetty on the waterfront.')}&location=${encodeURIComponent('Brouwersgracht 29, Amsterdam')}`
    : null

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        {/* Success card */}
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
          {/* Header */}
          <div className="bg-emerald-500 px-8 py-10 text-center">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-emerald-500" strokeWidth={3} />
            </div>
            <h1 className="text-2xl font-bold text-white">You&apos;re all set!</h1>
            <p className="text-emerald-100 mt-1">Your booking is confirmed</p>
          </div>

          {/* Body */}
          <div className="p-8 space-y-6">
            {booking ? (
              <>
                {/* Booking details */}
                <div className="space-y-3">
                  {booking.listing_title && (
                    <div className="text-center">
                      <h2 className="text-lg font-bold text-zinc-900">{booking.listing_title}</h2>
                    </div>
                  )}

                  <div className="bg-zinc-50 rounded-xl p-4 space-y-2 text-sm">
                    {bookingDate && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Date</span>
                        <span className="font-medium text-zinc-800">{bookingDate}</span>
                      </div>
                    )}
                    {startTime && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Time</span>
                        <span className="font-medium text-zinc-800">{startTime}</span>
                      </div>
                    )}
                    {booking.guest_count && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Guests</span>
                        <span className="font-medium text-zinc-800">{booking.guest_count}</span>
                      </div>
                    )}
                    {booking.booking_uuid && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Booking ref</span>
                        <span className="font-medium text-zinc-800 font-mono text-xs">
                          {booking.booking_uuid.slice(0, 8).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Email notice */}
                <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <Mail className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">Confirmation email sent</p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      Check your inbox at {booking.customer_email}
                    </p>
                  </div>
                </div>

                {/* Meeting point */}
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-sm font-medium text-amber-900 mb-1">Where to meet us</p>
                  <p className="text-sm text-amber-800">
                    Brouwersgracht 29, Amsterdam. Look for the big pier/jetty on the waterfront. Be there 10 minutes before your departure time — your skipper will be ready and waiting.
                  </p>
                  <a
                    href="https://maps.app.goo.gl/UR1tijSgfdMVfgLi6"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900"
                  >
                    Open in Google Maps →
                  </a>
                </div>

                {/* Add to calendar */}
                {calendarUrl && (
                  <a
                    href={calendarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                  >
                    <Calendar className="w-4 h-4" />
                    Add to Google Calendar
                  </a>
                )}
              </>
            ) : (
              /* Fallback when no booking found */
              <div className="text-center py-4">
                <p className="text-zinc-600 mb-2">
                  We couldn&apos;t find the details for this booking right now.
                </p>
                <p className="text-sm text-zinc-500">
                  Don&apos;t worry — check your email for the confirmation. If you don&apos;t see it,
                  reach out to us at{' '}
                  <a href="mailto:cruise@offcourseamsterdam.com" className="text-[var(--color-primary)] hover:underline">
                    cruise@offcourseamsterdam.com
                  </a>
                </p>
              </div>
            )}

            {/* Back to homepage */}
            <Link
              href={`/${locale}`}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

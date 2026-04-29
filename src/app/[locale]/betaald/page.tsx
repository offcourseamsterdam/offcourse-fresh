import { createAdminClient } from '@/lib/supabase/admin'

interface Props {
  searchParams: Promise<{ session_id?: string; cancelled?: string }>
}

export default async function BetaaldPage({ searchParams }: Props) {
  const params = await searchParams
  const isCancelled = params.cancelled === '1'

  if (isCancelled) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="text-4xl">😔</div>
          <h1 className="text-2xl font-semibold text-zinc-900">Payment cancelled</h1>
          <p className="text-zinc-500">
            Your payment wasn&apos;t completed. Reach out if something went wrong.
          </p>
          <a
            href="mailto:cruise@offcourseamsterdam.com"
            className="inline-block mt-4 text-sm text-zinc-600 underline"
          >
            cruise@offcourseamsterdam.com
          </a>
        </div>
      </main>
    )
  }

  const sessionId = params.session_id
  let booking = null

  if (sessionId) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('bookings')
      .select('customer_name, listing_title, booking_date, start_time, guest_count')
      .eq('stripe_session_id', sessionId)
      .maybeSingle()
    booking = data
  }

  const dateStr = booking?.booking_date
    ? new Date(booking.booking_date).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  const timeStr = booking?.start_time
    ? new Date(booking.start_time).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-5xl">⚓️</div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Payment received — see you on the water!
        </h1>
        <p className="text-zinc-500 leading-relaxed">
          {booking?.customer_name ? `Hey ${booking.customer_name}, ` : ''}
          your booking is confirmed. We can&apos;t wait!
        </p>

        {booking && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 text-left space-y-2 mt-6">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Cruise</span>
              <span className="font-medium text-zinc-900">{booking.listing_title}</span>
            </div>
            {dateStr && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Date</span>
                <span className="text-zinc-700">{dateStr}</span>
              </div>
            )}
            {timeStr && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Time</span>
                <span className="text-zinc-700">{timeStr}</span>
              </div>
            )}
            {booking.guest_count && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Guests</span>
                <span className="text-zinc-700">{booking.guest_count}</span>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-zinc-400 mt-6">
          Questions?{' '}
          <a href="mailto:cruise@offcourseamsterdam.com" className="underline">
            cruise@offcourseamsterdam.com
          </a>
        </p>
      </div>
    </main>
  )
}

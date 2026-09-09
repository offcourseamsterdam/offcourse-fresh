import { Calendar, Clock, Users, ArrowRight } from 'lucide-react'
import type { CruiseAvailabilitySnapshot } from '@/lib/fareharbor/sync-availability'
import type { Locale } from '@/lib/i18n/config'

interface Props {
  snapshot: CruiseAvailabilitySnapshot | null
  listingTitle: string
  category: 'private' | 'shared'
  startingPrice: number | null
  priceDisplay: string | null
  slug: string
  locale: Locale
}

export function UpcomingDeparturesSection({
  snapshot,
  category,
  startingPrice,
  priceDisplay,
  slug,
  locale,
}: Props) {
  if (!snapshot || snapshot.upcoming_days.length === 0) {
    return null
  }

  const isPrivate = category === 'private'
  const schedule = snapshot.schedule_summary

  return (
    <section aria-label="Upcoming Departures & Availability" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-primary)] flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[var(--color-accent)]" />
            Upcoming Departures &amp; Availability
          </h2>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Snapshot updated {new Date(snapshot.snapshot_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })} CEST · Live availability confirmed at checkout
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
          {isPrivate ? 'Exclusive Private Charter' : 'Shared Small Group Tour'}
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-100 p-5 shadow-sm space-y-5">
        {/* Availability rules banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-zinc-50 p-3 rounded-xl border border-zinc-100">
          <div className="flex items-center gap-2 text-zinc-600">
            <Users className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
            <span>{isPrivate ? 'Entire boat (up to 12 guests)' : 'Pay per person'}</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-600">
            <Clock className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
            <span>Daily {schedule.typicalStartTime} – {schedule.typicalEndTime}</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-600">
            <span className="font-bold text-[var(--color-accent)]">
              {priceDisplay ? priceDisplay : startingPrice ? `From €${startingPrice}` : 'Best price'}
            </span>
            <span>{isPrivate ? 'total boat' : 'per ticket'}</span>
          </div>
        </div>

        {/* Days & Slots list */}
        <div className="space-y-4">
          {snapshot.upcoming_days.slice(0, 4).map(day => (
            <div key={day.date} className="border-b border-zinc-100 last:border-b-0 pb-3 last:pb-0">
              <div className="flex items-baseline justify-between mb-2">
                <time dateTime={day.date} className="font-semibold text-sm text-[var(--color-ink)]">
                  {day.formattedDate}
                </time>
                <span className="text-[11px] text-[var(--color-muted)]">
                  {isPrivate ? 'Private boat available' : 'Open shared slots'}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {day.slots.map((slot, idx) => (
                  <a
                    key={`${slot.startIso}-${idx}`}
                    href={`/${locale}${slot.deepLink}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors text-xs font-medium text-zinc-700 group"
                  >
                    <time dateTime={slot.startIso}>{slot.startTime}</time>
                    <span className="text-[10px] text-zinc-400 group-hover:text-white/80">
                      ({slot.boat === 'diana' ? 'Diana' : 'Curaçao'})
                    </span>
                    <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Catering note if applicable */}
        {schedule.cateringCutoffHours && schedule.cateringCutoffHours > 24 && (
          <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
            ⏳ <strong>Notice:</strong> This cruise requires at least {schedule.cateringCutoffHours} hours advance notice for onboard catering &amp; chef preparation.
          </p>
        )}
      </div>
    </section>
  )
}

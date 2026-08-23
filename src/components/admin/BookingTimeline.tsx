'use client'

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminDate } from '@/lib/admin/format'
import type { BookingTimeline as BookingTimelineData } from '@/lib/ops/booking-timeline'

/** Phase 1 (visibility only) of docs/plans/2026-08-07-booking-ops-timeline-plan.md. */
export function BookingTimeline({ bookingId }: { bookingId: string }) {
  const { data, isLoading } = useAdminFetch<BookingTimelineData>(`/api/admin/bookings/${bookingId}/timeline`)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading timeline…
      </div>
    )
  }
  if (!data) return null

  const visibleSteps = data.steps.filter(s => s.applicable)

  return (
    <div className="space-y-1.5">
      {data.cancelled && (
        <p className="text-xs font-medium text-red-600">Booking cancelled</p>
      )}
      {visibleSteps.map(step => (
        <div key={step.key} className="flex items-center gap-2 text-xs">
          {step.done
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            : <Circle className="w-3.5 h-3.5 text-zinc-300 shrink-0" />}
          <span className={step.done ? 'text-zinc-700' : 'text-zinc-400'}>{step.label}</span>
          {step.occurredAt && (
            <span className="text-zinc-300">· {fmtAdminDate(step.occurredAt.split('T')[0])}</span>
          )}
        </div>
      ))}
    </div>
  )
}

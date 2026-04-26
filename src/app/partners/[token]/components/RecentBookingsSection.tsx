import { fmtEuros } from '@/lib/utils'

interface BookingItem {
  id: string
  listingTitle: string
  bookingDate: string | null
  startTime: string | null
  guestCount: number
  baseAmountCents: number
  commissionAmountCents: number
  customerEmailMasked: string
  isPartnerInvoice: boolean
}

export function RecentBookingsSection({ bookings }: { bookings: BookingItem[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Recent bookings</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Last 20 attributed to you.</p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-100">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Cruise</th>
              <th className="text-left px-4 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Date</th>
              <th className="text-right px-4 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Guests</th>
              <th className="text-right px-4 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Ticket</th>
              <th className="text-right px-4 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {bookings.map(b => (
              <tr key={b.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-zinc-900 truncate max-w-xs">{b.listingTitle}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {b.customerEmailMasked}{' '}
                    {b.isPartnerInvoice && <span className="text-emerald-700">· partner invoice</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">
                  {b.bookingDate ? formatBookingDate(b.bookingDate, b.startTime) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-700">{b.guestCount}</td>
                <td className="px-4 py-2.5 text-right text-zinc-700">{fmtEuros(b.baseAmountCents)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-zinc-900">{fmtEuros(b.commissionAmountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatBookingDate(dateIso: string, startTimeIso: string | null): string {
  const d = new Date(dateIso)
  const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  if (!startTimeIso) return datePart
  const t = new Date(startTimeIso)
  const timePart = t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
  return `${datePart} · ${timePart}`
}

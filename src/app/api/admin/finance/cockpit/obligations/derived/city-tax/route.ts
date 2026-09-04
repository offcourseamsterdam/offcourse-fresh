import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { accrueCityTax, cityTaxObligations, type CityTaxBooking } from '@/lib/finance/cockpit/derived/city-tax'
import { derivedConfirmKeysSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

type Admin = SupabaseClient<Database>

async function loadBookingsForYear(supabase: Admin, year: number): Promise<CityTaxBooking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, booking_uuid, booking_date, guest_count, status, booking_source')
    .gte('booking_date', `${year}-01-01`)
    .lte('booking_date', `${year}-12-31`)
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => ({
    id: r.id,
    bookingUuid: r.booking_uuid,
    bookingDate: r.booking_date,
    guestCount: r.guest_count,
    status: r.status,
    bookingSource: r.booking_source,
  }))
}

function yearFromKey(key: string): number | null {
  // 'city-tax:2026-Q3' → 2026
  const m = /^city-tax:(\d{4})-Q[1-4]$/.exec(key)
  return m ? Number(m[1]) : null
}

/** GET /api/admin/finance/cockpit/obligations/derived/city-tax?year= (default current year) */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const yearParam = request.nextUrl.searchParams.get('year')
  const year = yearParam ? Number(yearParam) : Number(todayISO().slice(0, 4))
  if (!Number.isInteger(year) || yearParam !== null && !/^\d{4}$/.test(yearParam)) {
    return apiError('year must be a 4-digit year', 400)
  }

  try {
    const supabase = createAdminClient()
    const rows = await loadBookingsForYear(supabase, year)
    const accrual = accrueCityTax(rows, { year, today: todayISO() })
    const proposals = cityTaxObligations(accrual)
    return apiOk({ accrual, proposals })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/city-tax GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not compute city tax accrual', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/obligations/derived/city-tax {keys: string[]}
 * Confirms one or more proposed quarters into real finance_obligations rows.
 * Idempotent via source_key: a key already backed by a row is reported as skipped,
 * never inserted twice.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, derivedConfirmKeysSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const years = [...new Set(parsed.data.keys.map(yearFromKey).filter((y): y is number => y !== null))]
    const proposalsByKey = new Map<string, { title: string; amountCents: number; dueDate: string }>()
    for (const year of years) {
      const rows = await loadBookingsForYear(supabase, year)
      const accrual = accrueCityTax(rows, { year, today: todayISO() })
      for (const p of cityTaxObligations(accrual)) proposalsByKey.set(p.key, p)
    }

    const created: Array<{ key: string; id: string }> = []
    const skipped: Array<{ key: string; reason: string }> = []

    for (const key of parsed.data.keys) {
      const proposal = proposalsByKey.get(key)
      if (!proposal) {
        skipped.push({ key, reason: 'Onbekende of niet meer geldige sleutel' })
        continue
      }

      const { data, error } = await supabase
        .from('finance_obligations')
        .insert({
          title: proposal.title,
          kind: 'tax',
          amount_cents: proposal.amountCents,
          due_date: proposal.dueDate,
          source_key: key,
          notes: 'Toeristenbelasting, automatisch berekend',
          status: 'open',
        })
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505') {
          skipped.push({ key, reason: 'already existed' })
          continue
        }
        return apiError(error.message, 500)
      }

      created.push({ key, id: data!.id })
      await logFinanceEvent(supabase, {
        event_type: 'obligation_created',
        actor: 'user',
        entity_type: 'obligation',
        entity_id: data!.id,
        delta_cents: proposal.amountCents,
        payload: { title: proposal.title, kind: 'tax', due_date: proposal.dueDate, source_key: key },
      })
    }

    return apiOk({ created, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/city-tax POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm city tax obligations', 500)
  }
}

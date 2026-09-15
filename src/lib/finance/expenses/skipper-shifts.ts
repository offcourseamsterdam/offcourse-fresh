import type { SupabaseClient } from '@supabase/supabase-js'

export interface ClaimedShiftCheckItem {
  description: string | null
  date: string | null // YYYY-MM-DD
  hours: number | null
  rateCents: number | null
  amountCents: number | null
  hasScheduledShift: boolean
  scheduledDetails?: string | null
  warning?: string | null
}

export interface ClaimedShiftsValidation {
  staffName: string | null
  staffId: string | null
  items: ClaimedShiftCheckItem[]
  allMatched: boolean
  unmatchedCount: number
}

interface ResolveStaffInput {
  supplierName?: string | null
  iban?: string | null
  contactEmail?: string | null
}

/**
 * Tries to identify which skipper (staff) this invoice belongs to.
 * Checks staff name, email, payment_aliases, and finance_suppliers linking.
 */
export async function resolveStaffForInvoice(
  supabase: SupabaseClient,
  input: ResolveStaffInput,
): Promise<{ id: string; name: string } | null> {
  const { data: allStaff } = await supabase
    .from('staff')
    .select('id, name, email, payment_aliases')

  if (!allStaff || allStaff.length === 0) return null

  const sName = (input.supplierName ?? '').toLowerCase().trim()
  const cEmail = (input.contactEmail ?? '').toLowerCase().trim()

  // 1. By contact email
  if (cEmail) {
    const byEmail = allStaff.find(s => s.email && s.email.toLowerCase() === cEmail)
    if (byEmail) return { id: byEmail.id, name: byEmail.name }
  }

  // 2. By exact or fuzzy name match
  if (sName) {
    // Exact staff name
    const exact = allStaff.find(s => s.name.toLowerCase() === sName)
    if (exact) return { id: exact.id, name: exact.name }

    // Contains or name parts (e.g. "GIJSBOTS" contains "gijs" or matches last name "bots")
    const cleanSName = sName.replace(/[^a-z0-9]/g, '')
    const byAliasOrPart = allStaff.find(s => {
      const cleanStaffName = s.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (cleanSName.includes(cleanStaffName) || cleanStaffName.includes(cleanSName)) return true
      if (Array.isArray(s.payment_aliases)) {
        for (const alias of s.payment_aliases) {
          const cleanAlias = String(alias).toLowerCase().replace(/[^a-z0-9]/g, '')
          if (cleanAlias && (cleanSName.includes(cleanAlias) || cleanAlias.includes(cleanSName))) return true
        }
      }
      // Check last name
      const nameParts = s.name.toLowerCase().split(/\s+/)
      const lastName = nameParts[nameParts.length - 1]
      if (lastName && lastName.length >= 4 && cleanSName.includes(lastName)) return true
      return false
    })

    if (byAliasOrPart) return { id: byAliasOrPart.id, name: byAliasOrPart.name }
  }

  // 3. By IBAN linked in finance_suppliers
  if (input.iban) {
    const cleanIban = input.iban.replace(/\s+/g, '').toUpperCase()
    const { data: sup } = await supabase
      .from('finance_suppliers')
      .select('staff_id, staff:staff(id, name)')
      .eq('iban', cleanIban)
      .maybeSingle()

    if (sup?.staff) {
      const st = sup.staff as unknown as { id: string; name: string }
      return { id: st.id, name: st.name }
    }
  }

  return null
}

/**
 * Checks extracted line items against the shifts table for the resolved (or any) skipper.
 */
export async function checkClaimedShiftsAgainstPlanning(
  supabase: SupabaseClient,
  opts: {
    lineItems: Array<{
      description?: string | null
      date?: string | null
      hours?: number | null
      rateCents?: number | null
      amountCents?: number | null
    }>
    supplierName?: string | null
    iban?: string | null
    contactEmail?: string | null
  },
): Promise<ClaimedShiftsValidation | null> {
  if (!opts.lineItems || opts.lineItems.length === 0) return null

  // Collect unique valid dates (YYYY-MM-DD)
  const dateItems = opts.lineItems.filter(item => item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date))
  if (dateItems.length === 0) return null

  const staff = await resolveStaffForInvoice(supabase, {
    supplierName: opts.supplierName,
    iban: opts.iban,
    contactEmail: opts.contactEmail,
  })

  const dates = Array.from(new Set(dateItems.map(i => i.date!)))

  // Load shifts on these dates
  const { data: shifts } = await supabase
    .from('shifts')
    .select('id, date, start_at, end_at, status, staff_id, staff:staff(name)')
    .in('date', dates)

  const shiftsByDate = new Map<string, Array<{
    id: string
    date: string
    start_at: string
    end_at: string
    status: string
    staff_id: string | null
    staffName: string | null
  }>>()

  for (const s of shifts ?? []) {
    const list = shiftsByDate.get(s.date) ?? []
    const staffObj = s.staff as unknown as { name: string } | null
    list.push({
      id: s.id,
      date: s.date,
      start_at: s.start_at,
      end_at: s.end_at,
      status: s.status,
      staff_id: s.staff_id,
      staffName: staffObj?.name ?? null,
    })
    shiftsByDate.set(s.date, list)
  }

  let unmatchedCount = 0

  const items: ClaimedShiftCheckItem[] = opts.lineItems.map(item => {
    if (!item.date || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      return {
        description: item.description ?? null,
        date: item.date ?? null,
        hours: item.hours ?? null,
        rateCents: item.rateCents ?? null,
        amountCents: item.amountCents ?? null,
        hasScheduledShift: false,
        warning: 'Geen datum herkend',
      }
    }

    const dayShifts = shiftsByDate.get(item.date) ?? []

    // Does this specific staff have an assigned shift?
    const matchedShift = staff?.id
      ? dayShifts.find(s => s.staff_id === staff.id)
      : dayShifts.find(s => s.staff_id != null)

    if (matchedShift) {
      const startFmt = matchedShift.start_at ? matchedShift.start_at.slice(11, 16) : ''
      const endFmt = matchedShift.end_at ? matchedShift.end_at.slice(11, 16) : ''
      const timeStr = startFmt && endFmt ? `${startFmt} - ${endFmt}` : ''

      return {
        description: item.description ?? null,
        date: item.date,
        hours: item.hours ?? null,
        rateCents: item.rateCents ?? null,
        amountCents: item.amountCents ?? null,
        hasScheduledShift: true,
        scheduledDetails: `Ingepland${timeStr ? ` (${timeStr})` : ''}`,
      }
    }

    // No shift found for this skipper
    unmatchedCount++
    const who = staff?.name ? staff.name : 'schipper'
    const otherShifts = dayShifts.filter(s => s.staff_id)
    let warnMsg = `Geen dienst gevonden voor ${who} in planning`
    if (otherShifts.length > 0) {
      const names = otherShifts.map(s => s.staffName).filter(Boolean).join(', ')
      warnMsg += ` (wel dienst voor: ${names})`
    } else if (dayShifts.length > 0) {
      warnMsg += ' (dienst staat als open / niet toegewezen)'
    }

    return {
      description: item.description ?? null,
      date: item.date,
      hours: item.hours ?? null,
      rateCents: item.rateCents ?? null,
      amountCents: item.amountCents ?? null,
      hasScheduledShift: false,
      warning: warnMsg,
    }
  })

  return {
    staffName: staff?.name ?? null,
    staffId: staff?.id ?? null,
    items,
    allMatched: unmatchedCount === 0,
    unmatchedCount,
  }
}

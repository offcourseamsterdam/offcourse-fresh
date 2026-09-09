import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { GmailMessage } from '@/lib/gmail/client'
import { formatAmsterdamTime } from '@/lib/utils'

type SupabaseAdmin = SupabaseClient<Database>

export interface MatchedCateringBooking {
  id: string
  customer_name: string | null
  booking_date: string | null
  start_time: string | null
  catering_thread_id: string | null
  catering_confirmed_at: string | null
}

const DUTCH_MONTHS: Record<string, string> = {
  januari: 'January',
  februari: 'February',
  maart: 'March',
  april: 'April',
  mei: 'May',
  juni: 'June',
  juli: 'July',
  augustus: 'August',
  september: 'September',
  oktober: 'October',
  november: 'November',
  december: 'December',
}

function parseDateFromSnippet(snippet: string): string | null {
  const isoMatch = snippet.match(/\b(202\d-[01]\d-[0-3]\d)\b/)
  if (isoMatch) return isoMatch[1]

  const wordsDateMatch = snippet.match(/(?:[A-Za-z]+,?\s+)?(\d{1,2})\s+([A-Za-z]+)\s+(202\d)/)
  if (wordsDateMatch) {
    const day = wordsDateMatch[1].padStart(2, '0')
    let month = wordsDateMatch[2].toLowerCase()
    if (DUTCH_MONTHS[month]) month = DUTCH_MONTHS[month]
    const year = wordsDateMatch[3]
    const parsed = new Date(`${day} ${month} ${year} 12:00:00 UTC`)
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }
  return null
}

/**
 * Extracts date (YYYY-MM-DD) and time (HH:MM) from catering order subject or body.
 */
export function extractCateringDateTime(text: string): { dateStr: string | null; timeStr: string | null } {
  let dateStr: string | null = null
  let timeStr: string | null = null

  // 1. Time matching: Prefer explicit "Time: 19:00"
  const timeExplicit = text.match(/Time:\s*([0-2]?\d:[0-5]\d)/i)
  if (timeExplicit) {
    timeStr = timeExplicit[1].padStart(5, '0')
  } else {
    const timeInSubject = text.match(/\b([0-2]?\d:[0-5]\d)\b/)
    if (timeInSubject) {
      timeStr = timeInSubject[1].padStart(5, '0')
    }
  }

  // 2. Date matching: Prefer explicit "Date: ..." line in quoted text, then subject, then full text
  const explicitDateLine = text.match(/Date:\s*([^\n\r]+)/i)
  if (explicitDateLine) {
    dateStr = parseDateFromSnippet(explicitDateLine[1])
  }

  if (!dateStr) {
    dateStr = parseDateFromSnippet(text)
  }

  return { dateStr, timeStr }
}

/**
 * Multi-layer matching cascade to find a pending catering booking for an incoming email:
 * 1. Booking ID Token in Subject or Body ([#ceab61d8] or #ceab61d8)
 * 2. Gmail Thread ID (catering_thread_id = message.threadId)
 * 3. Semantic metadata: Date + Time (+ Food items) match
 */
export async function matchCateringReplyToBooking(
  supabase: SupabaseAdmin,
  message: GmailMessage
): Promise<MatchedCateringBooking | null> {
  const combinedText = `${message.subject}\n${message.bodyText}`

  // Layer 1: Check for explicit booking ID token, e.g. [#ceab61d8] or Order ref: #ceab61d8
  const tokenMatch = combinedText.match(/\[#([a-f0-9]{8,36})\]|#([a-f0-9]{8,36})/i)
  if (tokenMatch) {
    try {
      const ref = (tokenMatch[1] || tokenMatch[2]).toLowerCase()
      const query = supabase
        .from('bookings')
        .select('id, customer_name, booking_date, start_time, catering_thread_id, catering_confirmed_at')
      if (typeof (query as any).ilike === 'function') {
        const { data: byToken } = await (query as any)
          .ilike('id', `${ref}%`)
          .is('catering_confirmed_at', null)
          .maybeSingle()
        if (byToken) return byToken
      }
    } catch {
      // Fall through if not supported
    }
  }

  // Layer 2: Match by Gmail Thread ID (standard path)
  if (message.threadId) {
    try {
      const { data: byThread } = await supabase
        .from('bookings')
        .select('id, customer_name, booking_date, start_time, catering_thread_id, catering_confirmed_at')
        .eq('catering_thread_id', message.threadId)
        .is('catering_confirmed_at', null)
        .maybeSingle()

      if (byThread) return byThread
    } catch {
      // Fall through
    }
  }

  // Layer 3: Semantic date + time match from Subject & Quoted text
  const isCateringEmail =
    message.subject.toLowerCase().includes('catering') ||
    combinedText.includes('Could you please prepare the following order') ||
    combinedText.toLowerCase().includes('bites box') ||
    combinedText.toLowerCase().includes('borrel box') ||
    message.from.email.toLowerCase().includes('pureboats')

  if (!isCateringEmail) return null

  const { dateStr, timeStr } = extractCateringDateTime(combinedText)
  if (!dateStr) return null

  try {
    // Query bookings for this date
    const { data: candidates } = await supabase
      .from('bookings')
      .select('id, customer_name, booking_date, start_time, catering_thread_id, catering_confirmed_at, extras_selected')
      .eq('booking_date', dateStr)
      .is('catering_confirmed_at', null)

    if (!candidates || candidates.length === 0) return null

    // Filter for bookings that have food catering
    const withFood = candidates.filter(b => {
      const extras = (b.extras_selected ?? []) as Array<{ category?: string; name?: string }>
      return extras.some(e => e.category === 'food' || (e.name && /bites|borrel|tapas|lunch|dinner|snack/i.test(e.name)))
    })

    if (withFood.length === 1) {
      return withFood[0]
    }

    // If multiple, filter by time
    if (timeStr && withFood.length > 1) {
      const timeMatch = withFood.find(b => {
        if (!b.start_time) return false
        const amsTime = formatAmsterdamTime(b.start_time)
        return amsTime === timeStr || b.start_time.includes(timeStr)
      })
      if (timeMatch) return timeMatch
    }

    return withFood[0] ?? null
  } catch {
    return null
  }
}

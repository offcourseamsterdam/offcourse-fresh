/**
 * Catering order email — plain text only.
 * No HTML, no styling. Reads like a regular email from a person.
 */

import { formatAmsterdamTime } from '@/lib/utils'

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-NL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtTime(timeStr: string | null): string {
  return formatAmsterdamTime(timeStr)
}

export interface CateringEmailInput {
  cruiseName: string
  dateStr: string | null
  timeStr: string | null
  guestCount: number | null
  items: Array<{ name: string; quantity?: number | null; is_per_person_pick?: boolean }>
}

export function buildCateringEmailText(input: CateringEmailInput): string {
  const { cruiseName, dateStr, timeStr, guestCount, items } = input
  const dateLabel = fmtDate(dateStr)
  const timeLabel = fmtTime(timeStr)

  const itemLines = items
    .map(item => {
      const qty = item.quantity ?? 1
      if (item.is_per_person_pick && qty > 0) {
        // qty represents people, not item count
        return `- ${item.name} (for ${qty} ${qty === 1 ? 'person' : 'people'})`
      }
      return `- ${item.name}${qty > 1 ? ` (${qty}x)` : ''}`
    })
    .join('\n')

  return [
    'Hi,',
    '',
    'Could you please prepare the following order for us:',
    '',
    `Cruise: ${cruiseName}`,
    `Date: ${dateLabel}`,
    `Time: ${timeLabel}`,
    `Guests: ${guestCount ?? '—'}`,
    '',
    'Items:',
    itemLines,
    '',
    'Could you please confirm receipt of this order by replying to this email?',
    '',
    'Thanks!',
    '',
    'Off Course Amsterdam',
    'cruise@offcourseamsterdam.com',
  ].join('\n')
}

export function buildCateringEmailSubject(cruiseName: string, dateStr: string | null, timeStr: string | null): string {
  const dateLabel = fmtDate(dateStr)
  const timeLabel = fmtTime(timeStr)
  return `Catering order — ${cruiseName} — ${dateLabel} ${timeLabel}`
}

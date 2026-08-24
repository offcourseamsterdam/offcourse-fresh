/**
 * Send a Slack alert when a booking arrives with catering items.
 *
 * - Normal: "🍽️ New catering order — review needed"
 * - Urgent:  "🚨 URGENT CATERING ORDER — cruise in Xh!" (< 24 h until departure)
 *
 * No-ops when there are no food items or Slack isn't configured.
 */

import { postSlackText, postSlackOps } from '@/lib/slack/send-notification'
import { formatAmsterdamTime } from '@/lib/utils'
import { filterFoodItems } from './filter'
import type { ExtrasLineItem } from './filter'
import { resolveCateringEmailRecipient, isExternalCateringRecipient } from './recipient'

export interface CateringNotifyInput {
  cruiseName: string
  dateStr: string | null
  /** Full ISO datetime, e.g. "2026-06-08T09:00:00+02:00". Used for urgency check. */
  startTimeStr: string | null
  guestCount: number | null
  extrasSelected: ExtrasLineItem[] | null
  /** The booked listing, if known — used to check for an external-caterer
   *  override (cruise_listings.catering_email_recipient) and, when one
   *  exists, additionally DM Beer directly (see below). Optional so existing
   *  callers that don't have a listing id handy keep working unchanged. */
  listingId?: string | null
}

export async function notifyCateringOrder(input: CateringNotifyInput): Promise<void> {
  // Only FOOD is a catering order (ordered from the supplier). Drinks like
  // "Unlimited Drinks" are stocked on the boat and must NOT trigger this alert —
  // matching the admin Food Orders page, which also lists food-only.
  const items = filterFoodItems(input.extrasSelected)
  if (items.length === 0) return

  const { cruiseName, dateStr, startTimeStr, guestCount, listingId } = input

  const dateLabel = dateStr
    ? new Date(dateStr + 'T12:00:00').toLocaleDateString('en-NL', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—'
  const timeLabel = formatAmsterdamTime(startTimeStr)

  const hoursUntil = startTimeStr
    ? (new Date(startTimeStr).getTime() - Date.now()) / 3_600_000
    : null
  const isUrgent = hoursUntil !== null && hoursUntil >= 0 && hoursUntil < 24

  const itemLines = items
    .map(i => {
      const qty = i.quantity ?? 1
      if (i.is_per_person_pick && qty > 0) {
        return `• ${i.name} (for ${qty} ${qty === 1 ? 'person' : 'people'})`
      }
      return `• ${i.name}${qty > 1 ? ` ×${qty}` : ''}`
    })
    .join('\n')

  const guestLine = guestCount ? `${guestCount} guests\n` : ''
  const adminUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'}/en/admin/catering`

  const message = isUrgent
    ? `🚨 *URGENT CATERING ORDER — cruise in ${Math.round(hoursUntil!)}h!*\n*${cruiseName}* — ${dateLabel} at ${timeLabel}\n${guestLine}${itemLines}\n\n<${adminUrl}|→ Admin: review catering>`
    : `🍽️ *New catering order — review needed*\n*${cruiseName}* — ${dateLabel} at ${timeLabel}\n${guestLine}${itemLines}\n\n<${adminUrl}|→ Admin: review catering>`

  const tasks: Promise<void>[] = [postSlackText(message)]

  // Listings with their own external caterer (e.g. the Curaçao Jamaican Buffet
  // Cruise — Ash's catering) get an EXTRA personal heads-up to Beer, alongside
  // the normal #bookings alert above, since the order is going to someone
  // outside the usual supplier and Beer wants eyes on that personally.
  if (listingId) {
    const recipient = await resolveCateringEmailRecipient(listingId)
    if (isExternalCateringRecipient(recipient)) {
      tasks.push(
        postSlackOps(
          `🍽️ *${cruiseName} booked* — food order going to *${recipient}*\n${dateLabel} at ${timeLabel}\n${guestLine}${itemLines}`
        )
      )
    }
  }

  await Promise.all(tasks)
}

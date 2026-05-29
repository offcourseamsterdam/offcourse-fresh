/**
 * Send an URGENT Slack alert when a booking can't be completed.
 *
 * Use this for any failure mode where the customer might have already paid
 * (or is mid-flow) but the booking didn't reach FareHarbor / Supabase.
 * Examples: FH validation returns is_bookable=false, FH createBooking throws,
 * Supabase insert fails, webhook safety-net fails.
 *
 * No-op (with console.error) when SLACK_WEBHOOK_URL isn't set.
 */

import { postSlackText } from '@/lib/slack/send-notification'

export type BookingFailureStage =
  | 'fareharbor_validate'   // FH says not bookable
  | 'fareharbor_create'     // FH 4xx/5xx during createBooking
  | 'supabase_save'         // Stripe + FH succeeded but DB insert failed
  | 'webhook_recovery'      // payment_intent.succeeded safety-net could not recover

const STAGE_LABEL: Record<BookingFailureStage, string> = {
  fareharbor_validate: 'FareHarbor validation',
  fareharbor_create:   'FareHarbor createBooking',
  supabase_save:       'Supabase save',
  webhook_recovery:    'Webhook recovery',
}

export interface BookingFailureContext {
  stage: BookingFailureStage
  reason: string
  /** Set when the customer has already been charged. */
  stripePaymentIntentId?: string | null
  amountCents?: number | null
  customer: {
    name?: string | null
    email?: string | null
    phone?: string | null
  }
  cruise: {
    listingTitle?: string | null
    date?: string | null
    startAt?: string | null
    guestCount?: number | null
    category?: string | null
  }
  fareharbor: {
    availPk?: number | string | null
    customerTypeRatePk?: number | string | null
    bookingUuid?: string | null
  }
  /** Free-form note shown verbatim, e.g. "Customer also charged on PI X (refunded)" */
  note?: string
}

export async function notifyBookingFailure(ctx: BookingFailureContext): Promise<void> {
  const paid = !!ctx.stripePaymentIntentId
  const banner = paid
    ? '🚨 *CRITICAL: PAID BUT NO BOOKING* 🚨'
    : '⚠️ *Booking failed (no payment captured)*'

  const subtitle = paid
    ? `_Customer was charged but the booking could not be completed at ${STAGE_LABEL[ctx.stage]}._`
    : `_Failed at ${STAGE_LABEL[ctx.stage]} — customer NOT charged._`

  const lines = [
    banner,
    subtitle,
    '',
    `*Stage:* ${STAGE_LABEL[ctx.stage]}`,
    `*Reason:* \`${ctx.reason}\``,
  ]

  if (paid) {
    lines.push(`*Stripe PI:* \`${ctx.stripePaymentIntentId}\``)
    if (ctx.amountCents != null) {
      lines.push(`*Amount:* €${(ctx.amountCents / 100).toFixed(2)}`)
    }
    lines.push(
      `<https://dashboard.stripe.com/payments/${ctx.stripePaymentIntentId}|Open PI in Stripe>`,
    )
  }

  lines.push('')
  if (ctx.customer.name || ctx.customer.email || ctx.customer.phone) {
    lines.push(`*Customer:* ${ctx.customer.name ?? '?'} · ${ctx.customer.email ?? '?'} · ${ctx.customer.phone ?? '?'}`)
  }
  if (ctx.cruise.listingTitle) {
    const timeStr = ctx.cruise.startAt
      ? new Date(ctx.cruise.startAt).toLocaleTimeString('nl-NL', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
        })
      : ''
    lines.push(`*Cruise:* ${ctx.cruise.listingTitle} · ${ctx.cruise.date ?? '?'}${timeStr ? ' · ' + timeStr : ''}`)
  }
  if (ctx.cruise.guestCount != null || ctx.cruise.category) {
    lines.push(`*Guests:* ${ctx.cruise.guestCount ?? '?'}${ctx.cruise.category ? ' · ' + ctx.cruise.category : ''}`)
  }
  if (ctx.fareharbor.availPk || ctx.fareharbor.customerTypeRatePk) {
    lines.push(`*FH:* avail_pk \`${ctx.fareharbor.availPk ?? '?'}\` · ct_rate_pk \`${ctx.fareharbor.customerTypeRatePk ?? '?'}\``)
  }
  if (ctx.fareharbor.bookingUuid) {
    lines.push(`*FH UUID:* \`${ctx.fareharbor.bookingUuid}\``)
  }

  if (ctx.note) {
    lines.push('', ctx.note)
  }

  if (paid) {
    lines.push(
      '',
      '_Action: manually recreate via Admin → FareHarbor flow with "Stripe recovery" source, or refund the PI._',
    )
  }

  await postSlackText(lines.join('\n'))
}

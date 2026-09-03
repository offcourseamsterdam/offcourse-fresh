import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/require-admin'
import { apiOk, apiError } from '@/lib/api/response'
import { getStripe } from '@/lib/stripe/server'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { CITY_TAX_CENTS_PER_GUEST } from '@/lib/booking/constants'
import { postSlackOps } from '@/lib/slack/send-notification'

export interface InvoiceFinanceItem {
  id: string
  bookingId: string
  bookingDate: string | null
  startTime: string | null
  listingTitle: string | null
  customerName: string | null
  customerEmail: string | null
  companyName: string | null
  companyKvk: string | null
  stripeInvoiceId: string | null
  stripeInvoiceUrl: string | null
  paymentStatus: string | null
  amountCents: number
  invoiceDueDate: string | null
  isOverdue: boolean
  daysUntilDue: number | null
  createdAt: string
}

export interface FinanceInvoicesResponse {
  openInvoices: InvoiceFinanceItem[]
  paidInvoices: InvoiceFinanceItem[]
  stats: {
    openCount: number
    openAmountCents: number
    paidCount: number
    paidAmountCents: number
    overdueCount: number
  }
}

export async function GET(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const shouldSync = searchParams.get('sync') === 'true'

    const { data: bookings, error: dbError } = await supabase
      .from('bookings')
      .select(`
        id,
        booking_id,
        booking_date,
        start_time,
        listing_title,
        customer_name,
        customer_email,
        company_name,
        company_kvk,
        stripe_invoice_id,
        stripe_invoice_url,
        payment_status,
        base_amount_cents,
        extras_amount_cents,
        guest_count,
        stripe_amount,
        invoice_due_date,
        created_at
      `)
      .not('stripe_invoice_id', 'is', null)
      .order('booking_date', { ascending: false })

    if (dbError) {
      return apiError(dbError.message, 500)
    }

    const todayStr = new Date().toISOString().split('T')[0]
    let changed = false

    // Optional real-time sync with Stripe for open invoices
    if (shouldSync && bookings && bookings.length > 0) {
      const stripe = getStripe()
      for (const b of bookings) {
        if (b.payment_status === 'stripe_invoice_sent' && b.stripe_invoice_id) {
          try {
            const stripeInv = await stripe.invoices.retrieve(b.stripe_invoice_id)
            if (stripeInv.status === 'paid') {
              await supabase
                .from('bookings')
                .update({
                  payment_status: 'paid',
                  stripe_amount: stripeInv.amount_paid ?? undefined,
                })
                .eq('id', b.id)
              b.payment_status = 'paid'
              b.stripe_amount = stripeInv.amount_paid
              changed = true

              await postSlackOps([
                `💶 *Stripe Invoice PAID & Auto-Reconciled!*`,
                `👤 *Beer Zoomers* (Ops Alert)`,
                `🏢 *${b.company_name || b.customer_name || 'Guest'}* · €${((stripeInv.amount_paid ?? 0) / 100).toFixed(2)}`,
                `Invoice: \`${stripeInv.number || stripeInv.id}\``,
                b.listing_title ? `Cruise: ${b.listing_title} (${b.booking_date})` : '',
              ].filter(Boolean).join('\n')).catch(err => console.error('[finance/invoices] Slack error:', err))
            }
          } catch (err) {
            console.warn('[finance/invoices] stripe sync check failed for', b.stripe_invoice_id, err)
          }
        }
      }
      if (changed) {
        await notifyBookingsChanged()
      }
    }

    const openInvoices: InvoiceFinanceItem[] = []
    const paidInvoices: InvoiceFinanceItem[] = []

    let openAmountCents = 0
    let paidAmountCents = 0
    let overdueCount = 0

    for (const b of (bookings ?? [])) {
      const cityTaxCents = (Number(b.guest_count) || 1) * CITY_TAX_CENTS_PER_GUEST
      const amount = b.stripe_amount && b.stripe_amount > 0
        ? b.stripe_amount
        : (b.base_amount_cents ?? 0) + (b.extras_amount_cents ?? 0) + cityTaxCents

      let isOverdue = false
      let daysUntilDue: number | null = null

      if (b.invoice_due_date) {
        const dueDate = new Date(b.invoice_due_date)
        const today = new Date(todayStr)
        const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        daysUntilDue = diffDays
        if (diffDays < 0 && b.payment_status !== 'paid') {
          isOverdue = true
          overdueCount++
        }
      }

      const item: InvoiceFinanceItem = {
        id: b.id,
        bookingId: b.booking_id ?? b.id,
        bookingDate: b.booking_date,
        startTime: b.start_time,
        listingTitle: b.listing_title,
        customerName: b.customer_name,
        customerEmail: b.customer_email,
        companyName: b.company_name,
        companyKvk: b.company_kvk,
        stripeInvoiceId: b.stripe_invoice_id,
        stripeInvoiceUrl: b.stripe_invoice_url,
        paymentStatus: b.payment_status,
        amountCents: amount,
        invoiceDueDate: b.invoice_due_date,
        isOverdue,
        daysUntilDue,
        createdAt: b.created_at ?? '',
      }

      if (b.payment_status === 'paid') {
        paidInvoices.push(item)
        paidAmountCents += amount
      } else {
        openInvoices.push(item)
        openAmountCents += amount
      }
    }

    return apiOk<FinanceInvoicesResponse>({
      openInvoices,
      paidInvoices,
      stats: {
        openCount: openInvoices.length,
        openAmountCents,
        paidCount: paidInvoices.length,
        paidAmountCents,
        overdueCount,
      },
    })
  } catch (err) {
    console.error('[finance/invoices] Error:', err)
    return apiError(err instanceof Error ? err.message : 'Fout bij ophalen facturen', 500)
  }
}

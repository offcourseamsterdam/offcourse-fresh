import { getStripe } from '@/lib/stripe/server'
import { CITY_TAX_CENTS_PER_GUEST } from '@/lib/booking/constants'
import type Stripe from 'stripe'

export interface BusinessCustomerInput {
  name: string
  email: string
  phone?: string | null
  companyName?: string | null
  kvkNumber?: string | null
  vatNumber?: string | null
  address?: {
    line1?: string | null
    postal_code?: string | null
    city?: string | null
    country?: string | null
  } | null
}

export interface CreateInvoiceInput {
  customerId: string
  bookingId: string
  fhBookingUuid?: string | null
  listingTitle: string
  bookingDate: string // YYYY-MM-DD
  startTime?: string | null
  guestCount: number
  baseAmountCents: number
  extrasSelected?: Array<{ name: string; amount_cents: number }>
  cityTaxCents?: number | null
  discountAmountCents?: number | null
  category?: string | null
  note?: string | null
  daysAfterTour?: number // Defaults to 14
}

export interface StripeInvoiceResult {
  invoiceId: string
  invoiceNumber: string | null
  hostedInvoiceUrl: string | null
  pdfUrl: string | null
  status: string | null
  dueDate: string
  dueDateTimestamp: number
  amountDueCents: number
}

/**
 * Compute the invoice due date: exactly N days (default 14) after the tour has happened.
 *
 * Example:
 *   tourDate = '2026-09-15'
 *   14 days after tour = '2026-09-29'
 *   dueDateTimestamp = end of day (23:59:59 Europe/Amsterdam) on 2026-09-29
 */
export function computeInvoiceDueDate(tourDateYmd: string, daysAfterTour: number = 14): {
  dueDateTimestamp: number
  dueDateFormatted: string
} {
  // Parse tour date (assume midnight in Amsterdam)
  const tourDate = new Date(`${tourDateYmd}T12:00:00Z`)
  const dueDate = new Date(tourDate.getTime() + daysAfterTour * 24 * 60 * 60 * 1000)

  // End of due day (23:59:59 Amsterdam time ≈ 21:59:59 UTC in summer, 22:59:59 UTC in winter)
  const dueYmd = dueDate.toISOString().slice(0, 10)
  const dueTimestamp = Math.floor(new Date(`${dueYmd}T21:59:59Z`).getTime() / 1000)

  // Stripe requires due_date to be strictly in the future.
  // If a tour was in the past and 14 days have already elapsed, set to at least 24h from now.
  const minFutureTimestamp = Math.floor(Date.now() / 1000) + 86400
  const finalTimestamp = Math.max(dueTimestamp, minFutureTimestamp)
  const finalDueDateFormatted = new Date(finalTimestamp * 1000).toISOString().slice(0, 10)

  return {
    dueDateTimestamp: finalTimestamp,
    dueDateFormatted: finalDueDateFormatted,
  }
}

/**
 * Find or create a Stripe Customer with business billing details & Tax ID.
 */
export async function getOrCreateStripeCustomer(input: BusinessCustomerInput): Promise<Stripe.Customer> {
  const stripe = getStripe()
  const email = input.email.trim().toLowerCase()

  // 1. Check if a customer with this email already exists
  const existing = await stripe.customers.list({ email, limit: 1 })
  if (existing.data.length > 0) {
    const customer = existing.data[0]
    // Update address and metadata if provided
    const updateParams: Stripe.CustomerUpdateParams = {
      name: input.companyName?.trim() || input.name.trim(),
      phone: input.phone?.trim() || undefined,
      metadata: {
        contact_person: input.name.trim(),
        company_name: input.companyName?.trim() || '',
        kvk_number: input.kvkNumber?.trim() || '',
        vat_number: input.vatNumber?.trim() || '',
      },
    }

    if (input.address?.line1) {
      updateParams.address = {
        line1: input.address.line1.trim(),
        postal_code: input.address.postal_code?.trim() || undefined,
        city: input.address.city?.trim() || undefined,
        country: input.address.country?.trim() || 'NL',
      }
    }

    const updated = await stripe.customers.update(customer.id, updateParams)

    if (input.vatNumber) {
      const cleanedVat = input.vatNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      try {
        const existingTaxIds = await stripe.customers.listTaxIds(customer.id)
        const alreadyAttached = existingTaxIds.data.some(t => t.value === cleanedVat)
        if (!alreadyAttached) {
          await stripe.customers.createTaxId(customer.id, {
            type: 'eu_vat',
            value: cleanedVat,
          })
        }
      } catch (taxErr) {
        console.warn('[invoicing] Could not attach Tax ID to existing customer:', taxErr)
      }
    }

    return updated
  }

  // 2. Create new Stripe customer
  const createParams: Stripe.CustomerCreateParams = {
    name: input.companyName?.trim() || input.name.trim(),
    email,
    phone: input.phone?.trim() || undefined,
    address: input.address?.line1 ? {
      line1: input.address.line1.trim(),
      postal_code: input.address.postal_code?.trim() || undefined,
      city: input.address.city?.trim() || undefined,
      country: input.address.country?.trim() || 'NL',
    } : undefined,
    metadata: {
      contact_person: input.name.trim(),
      company_name: input.companyName?.trim() || '',
      kvk_number: input.kvkNumber?.trim() || '',
      vat_number: input.vatNumber?.trim() || '',
    },
  }

  const customer = await stripe.customers.create(createParams)

  // 3. Attach EU VAT Tax ID if provided
  if (input.vatNumber) {
    const cleanedVat = input.vatNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    try {
      await stripe.customers.createTaxId(customer.id, {
        type: 'eu_vat',
        value: cleanedVat,
      })
    } catch (taxErr) {
      console.warn('[invoicing] Could not attach Tax ID to customer:', taxErr)
    }
  }

  return customer
}

/**
 * Format tour date and optional start time into readable Dutch format.
 * Example: '2026-08-28' with '2026-08-28T17:00:00+00:00' -> '28 augustus 2026 om 19:00'
 */
export function formatTourDateDutch(dateStr: string, startTime?: string | null): string {
  try {
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T12:00:00Z' : ''))
    const formatted = d.toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Amsterdam',
    })
    if (startTime) {
      const timeStr = new Date(startTime).toLocaleTimeString('nl-NL', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Amsterdam',
      })
      if (timeStr && timeStr !== '—') {
        return `${formatted} om ${timeStr}`
      }
    }
    return formatted
  } catch {
    return dateStr
  }
}

/**
 * Create, finalize, and email a Stripe Invoice with Virtual IBAN / SEPA transfer support
 * and Dutch VAT breakdown lines.
 */
export async function createAndSendStripeInvoice(input: CreateInvoiceInput): Promise<StripeInvoiceResult> {
  const stripe = getStripe()
  const { dueDateTimestamp, dueDateFormatted } = computeInvoiceDueDate(
    input.bookingDate,
    input.daysAfterTour ?? 14
  )

  const guestCount = Number(input.guestCount ?? 1)
  const cityTaxCents = input.cityTaxCents ?? (guestCount * CITY_TAX_CENTS_PER_GUEST)
  const discountCents = Number(input.discountAmountCents ?? 0)
  const tourDateFormatted = formatTourDateDutch(input.bookingDate, input.startTime)

  // Step 1: Create the draft Stripe Invoice (with Virtual IBAN / customer_balance in EUR)
  const baseInvoiceParams: Stripe.InvoiceCreateParams = {
    customer: input.customerId,
    currency: 'eur',
    collection_method: 'send_invoice',
    due_date: dueDateTimestamp,
    auto_advance: true,
    custom_fields: [
      { name: 'Tourdatum', value: tourDateFormatted },
    ],
    metadata: {
      booking_id: input.bookingId,
      fareharbor_uuid: input.fhBookingUuid ?? '',
      listing_title: input.listingTitle,
      booking_date: input.bookingDate,
      tour_date_formatted: tourDateFormatted,
      booking_source: 'stripe_invoice',
      guest_count: String(guestCount),
    },
    description: `Off Course Amsterdam — ${input.listingTitle} (Tourdatum: ${tourDateFormatted})`,
    footer: 'Bedankt voor uw boeking bij Off Course Amsterdam. U kunt betalen via iDEAL, creditcard of overboeking op deze factuur.',
  }

  let invoice: Stripe.Invoice
  try {
    invoice = await stripe.invoices.create({
      ...baseInvoiceParams,
      payment_settings: {
        payment_method_types: ['customer_balance', 'card', 'ideal', 'bancontact'],
        payment_method_options: {
          customer_balance: {
            funding_type: 'bank_transfer',
            bank_transfer: {
              type: 'eu_bank_transfer',
              eu_bank_transfer: {
                country: 'NL',
              },
            },
          },
        },
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('customer_balance')) {
      console.warn('[invoicing] customer_balance not supported for this account, falling back to card, ideal, bancontact')
      invoice = await stripe.invoices.create({
        ...baseInvoiceParams,
        payment_settings: {
          payment_method_types: ['card', 'ideal', 'bancontact'],
        },
      })
    } else {
      throw err
    }
  }

  // Step 2: Create Line Items for the invoice

  // Line 1: Cruise base fare (9% BTW included)
  if (input.baseAmountCents > 0) {
    await stripe.invoiceItems.create({
      customer: input.customerId,
      invoice: invoice.id,
      amount: input.baseAmountCents,
      currency: 'eur',
      description: `${input.listingTitle} — Tourdatum: ${tourDateFormatted} (${guestCount} ${guestCount === 1 ? 'gast' : 'gasten'}) — 9% BTW incl.`,
    })
  }

  // Line 2..N: Extras (21% BTW included)
  if (input.extrasSelected && input.extrasSelected.length > 0) {
    for (const extra of input.extrasSelected) {
      if (extra.amount_cents > 0) {
        await stripe.invoiceItems.create({
          customer: input.customerId,
          invoice: invoice.id,
          amount: extra.amount_cents,
          currency: 'eur',
          description: `${extra.name} — 21% BTW incl.`,
        })
      }
    }
  }

  // Line N+1: City Tax (0% BTW)
  if (cityTaxCents > 0) {
    await stripe.invoiceItems.create({
      customer: input.customerId,
      invoice: invoice.id,
      amount: cityTaxCents,
      currency: 'eur',
      description: `Toeristenbelasting / City Tax (€2.60 × ${guestCount}) — 0% BTW`,
    })
  }

  // Line N+2: Discount (negative amount)
  if (discountCents > 0) {
    await stripe.invoiceItems.create({
      customer: input.customerId,
      invoice: invoice.id,
      amount: -discountCents,
      currency: 'eur',
      description: `Korting / Promotional Discount — 9% BTW incl.`,
    })
  }

  // Step 3: Finalize Invoice (freezes line items and generates Invoice Number + Virtual IBAN)
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
    auto_advance: true,
  })

  // Step 4: Send the invoice email from Stripe (only if open, paid invoices cannot be sent)
  const sent = finalized.status === 'open'
    ? await stripe.invoices.sendInvoice(finalized.id)
    : finalized

  return {
    invoiceId: sent.id,
    invoiceNumber: sent.number ?? null,
    hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
    pdfUrl: sent.invoice_pdf ?? null,
    status: sent.status ?? null,
    dueDate: dueDateFormatted,
    dueDateTimestamp,
    amountDueCents: sent.amount_due,
  }
}

/**
 * Mark a Stripe Invoice as paid out-of-band (e.g. customer paid to regular bank account).
 */
export async function markStripeInvoicePaidOutOfBand(invoiceId: string): Promise<Stripe.Invoice> {
  const stripe = getStripe()
  return await stripe.invoices.pay(invoiceId, {
    paid_out_of_band: true,
  })
}

/**
 * Void a Stripe Invoice upon booking cancellation.
 */
export async function voidStripeInvoice(invoiceId: string): Promise<Stripe.Invoice> {
  const stripe = getStripe()
  return await stripe.invoices.voidInvoice(invoiceId)
}

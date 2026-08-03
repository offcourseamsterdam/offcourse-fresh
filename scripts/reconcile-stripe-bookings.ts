#!/usr/bin/env -S npx tsx
/**
 * reconcile-stripe-bookings.ts — verify every succeeded Stripe charge has a
 * matching row in `bookings`.
 *
 * Stripe is the ground truth for what money actually moved; our `bookings`
 * table is what every VAT/finance report in the admin Finance tab is built
 * from. The webhook is designed to always write a row the instant a payment
 * succeeds (see the "write-row-first" comment in
 * src/app/api/webhooks/stripe/route.ts) and to Slack-alert on failure — but
 * an alert can be missed, and a webhook delivery can fail to arrive at all.
 * This script is the independent check: it doesn't trust our own DB, it
 * asks Stripe directly and diffs.
 *
 * A gap here is not a rounding error — it means real money that came in is
 * currently invisible to every VAT/revenue number this project reports.
 *
 * Usage (from repo root):
 *   npx tsx scripts/reconcile-stripe-bookings.ts
 *
 * READ-ONLY. Reads Stripe + Supabase. Never writes anything.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ── Load .env.local (no dotenv dependency — mirrors scripts/conversion-report.ts) ──
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const withoutExport = trimmed.replace(/^export\s+/, '')
      const eq = withoutExport.indexOf('=')
      if (eq === -1) continue
      const key = withoutExport.slice(0, eq).trim()
      let val = withoutExport.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    console.error('⚠️  Could not read .env.local — relying on existing process env.')
  }
}
loadEnv()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // 1. Every succeeded Stripe charge, ever (paginated).
  let startingAfter: string | undefined
  let succeededGrossCents = 0
  let refundedCents = 0
  const succeeded = new Map<string, Stripe.Charge>() // keyed by payment_intent id

  for (;;) {
    const page = await stripe.charges.list({ limit: 100, starting_after: startingAfter })
    for (const ch of page.data) {
      if (ch.status !== 'succeeded') continue
      const piId = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id
      if (!piId) continue
      succeeded.set(piId, ch)
      succeededGrossCents += ch.amount
      refundedCents += ch.amount_refunded ?? 0
    }
    if (!page.has_more) break
    startingAfter = page.data[page.data.length - 1].id
  }

  // 2. Every bookings row that claims a Stripe payment.
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('stripe_payment_intent_id, stripe_amount, payment_status')
    .not('stripe_payment_intent_id', 'is', null)
  if (error) throw new Error(`Supabase query failed: ${error.message}`)

  const ourPIs = new Set((bookings ?? []).map(b => b.stripe_payment_intent_id as string))

  // 3. Diff.
  const missing = [...succeeded.keys()].filter(pi => !ourPIs.has(pi))

  console.log('=== Stripe (ground truth) ===')
  console.log(`Succeeded charges: ${succeeded.size}`)
  console.log(`Gross: €${(succeededGrossCents / 100).toFixed(2)}  ·  Refunded: €${(refundedCents / 100).toFixed(2)}  ·  Net: €${((succeededGrossCents - refundedCents) / 100).toFixed(2)}`)
  console.log(`\n=== bookings table ===`)
  console.log(`Rows with a stripe_payment_intent_id: ${bookings?.length ?? 0}`)

  if (missing.length === 0) {
    console.log('\n✅ Every succeeded Stripe charge has a matching bookings row. Nothing missing.')
    return
  }

  console.log(`\n🚨 ${missing.length} succeeded Stripe charge(s) have NO matching bookings row:`)
  const openIssues: string[] = []
  for (const piId of missing) {
    const ch = succeeded.get(piId)!
    const isRefunded = ch.amount_refunded >= ch.amount
    const line = `  ${isRefunded ? '↩️ refunded' : '⚠️  STILL OPEN'} — €${(ch.amount / 100).toFixed(2)} — ${new Date(ch.created * 1000).toISOString().slice(0, 10)} — ${piId}`
    console.log(line)
    if (!isRefunded) openIssues.push(piId)
  }

  if (openIssues.length > 0) {
    console.log(`\n🚨🚨 ${openIssues.length} of those were NEVER refunded — real, uncredited revenue with no booking record.`)
    console.log('    Retrieve each PI (stripe.paymentIntents.retrieve) to get the customer/booking metadata and investigate by hand.')
    process.exitCode = 1
  } else {
    console.log('\nAll missing ones were fully refunded — no live revenue gap, but each still represents a booking attempt with no row in our system (a gap in the audit trail, not in the money).')
  }
}

main().catch(err => {
  console.error('Reconciliation failed:', err)
  process.exit(1)
})

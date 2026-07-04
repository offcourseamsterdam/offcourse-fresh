/**
 * Insert (or clean up) a DEMO guest_move_request proposal so the public
 * response page and the admin card can be eyeballed without waiting for a
 * real gap day. Never contacts anyone; delete with `--cleanup`.
 *
 * Run:    npx tsx --tsconfig tsconfig.scripts.json scripts/demo-guest-move.ts
 * Clean:  npx tsx --tsconfig tsconfig.scripts.json scripts/demo-guest-move.ts --cleanup
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const val = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
} catch { /* rely on existing env */ }

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { moveResponseUrl } = await import('@/lib/ops/move-token')
  const supabase = createAdminClient()

  if (process.argv.includes('--cleanup')) {
    const { data } = await supabase
      .from('agent_proposals')
      .delete()
      .eq('kind', 'guest_move_request')
      .eq('payload->>demo', 'true')
      .select('id')
    console.log(`Deleted ${data?.length ?? 0} demo proposal(s).`)
    return
  }

  const { data: inserted, error } = await supabase
    .from('agent_proposals')
    .insert({
      kind: 'guest_move_request',
      status: 'approved', // "sent, awaiting the guest" — so the page shows live
      payload: {
        demo: 'true',
        target_date: '2026-07-05',
        booking_id: null,
        guest_name: 'Demo Gast',
        guest_email: 'demo@example.com',
        guest_phone: null,
        cruise_title: 'Shared Hidden Gems Cruise',
        guest_count: 4,
        boat: 'Curaçao',
        current_start_at: '2026-07-05T13:00:00Z',
        proposed_start_at: '2026-07-05T11:30:00Z',
        gap_minutes: 90,
        est_saving_cents: 4500,
        total_cents: 15600,
        incentive: 'a bottle of wine on the house',
        listing_slug: 'demo-cruise',
        customer_type_rate_pk: 555,
        fh_customer_count: 4,
        snapped_from: '2026-07-05T11:15:00Z',
        verdict: {
          ran_at: new Date().toISOString(),
          is_bookable: true,
          code: null,
          error: null,
          receipt_total_eur: 156,
          checked_avail_pk: 999,
        },
        sms_text: 'Hey! Quick one from Off Course: would 13:30 instead of 15:00 work for Saturday? Same boat, same price — and a bottle of wine on us. One tap to answer: {{link}} Totally fine to keep your time!',
        email_subject: 'Small favour — would 13:30 work on Saturday?',
        email_body: 'Hey Demo,\n\nQuick question about your Shared Hidden Gems Cruise on 2026-07-05 (4 people, €156.00 — unchanged): would 13:30 instead of 15:00 work for you? Same boat, same cruise, and we will put a bottle of wine on board on us.\n\nOne tap to answer: {{link}}\n\nTotally fine to say no — your original time stays reserved either way.\n\nOff Course Amsterdam',
      },
      reasoning: 'DEMO row for eyeballing the response page + admin card.',
      outcome: { sent_at: new Date().toISOString(), channels: ['email'] },
      model: null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  console.log('Demo proposal:', inserted!.id)
  console.log('Response page:', moveResponseUrl(process.env.DEMO_BASE_URL ?? 'http://localhost:3001', inserted!.id))
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

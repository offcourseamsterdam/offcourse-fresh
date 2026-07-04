/**
 * Run the operations optimizer once, for real — the same draftOpsReview()
 * the ghost-ops cron calls nightly. Syncs shifts first (like the cron), then
 * lets the agent review tomorrow and write its shadow ops_review proposal.
 *
 * Real Claude call (metered via ai_usage), real DB writes (shifts sync +
 * shadow proposal + ops_events row). Nothing executes, no emails, no guests.
 *
 * Run: npx tsx --import ./scripts/_preload-env.mjs --tsconfig tsconfig.scripts.json scripts/run-ops-review.ts
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
  const { syncShiftsForRange } = await import('@/lib/scheduling/sync-shifts')
  const { draftOpsReview } = await import('@/lib/ghost/ops-review')
  const { amsterdamToday } = await import('@/lib/utils')

  const supabase = createAdminClient()
  const tomorrow = amsterdamToday(1)

  console.log(`\n━━━ Step 1: sync bookings → shifts (${amsterdamToday()} … ${tomorrow}) ━━━`)
  const sync = await syncShiftsForRange(supabase, amsterdamToday(), tomorrow)
  console.log('  ', sync)

  console.log(`\n━━━ Step 2: draftOpsReview() for ${tomorrow} ━━━`)
  const result = await draftOpsReview()
  console.log('   result:', result)

  const { data: proposal } = await supabase
    .from('agent_proposals')
    .select('id, kind, reasoning, payload, created_at')
    .eq('kind', 'ops_review')
    .eq('payload->>target_date', tomorrow)
    .maybeSingle()

  if (proposal) {
    console.log('\n━━━ The shadow proposal ━━━')
    console.log('   id:', proposal.id)
    console.log('   reasoning:', proposal.reasoning)
    const payload = proposal.payload as { recommendations?: unknown[]; facts?: unknown; steps?: unknown[] }
    console.log('   facts:', JSON.stringify(payload.facts))
    console.log('   agent tool steps:', (payload.steps ?? []).length)
    for (const r of (payload.recommendations ?? []) as Array<Record<string, unknown>>) {
      console.log(`   → [${r.type}] ${r.summary}`)
      console.log(`      why: ${r.why}`)
      console.log(`      saves €${(Number(r.est_saving_cents) / 100).toFixed(2)} · guest impact ${r.guest_impact} · guest contact ${r.requires_guest_contact ? 'YES' : 'no'} · confidence ${r.confidence}`)
    }
  } else {
    console.log('\n   (no proposal row — likely no shifts tomorrow, so the drafter skipped at zero cost)')
  }

  const { data: events } = await supabase
    .from('ops_events')
    .select('event_type, actor_type, actor_id, source, payload, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(3)
  console.log('\n━━━ Latest ops_events rows ━━━')
  for (const e of events ?? []) console.log(`   ${e.occurred_at} · ${e.event_type} · ${e.actor_type}:${e.actor_id ?? '-'} · ${e.source}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

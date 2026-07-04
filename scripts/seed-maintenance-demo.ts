/**
 * Live demo: simulate a "Maintenance and Ideas" Slack post → real Claude
 * classification + email draft → insert the maintenance_tasks board record AND
 * the maintenance_task Ghost proposal (shadow). Proves the live DB schema
 * (CHECK constraints, text[] columns) + the UI render + the send path.
 *
 * Run: npx tsx scripts/seed-maintenance-demo.ts
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
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
} catch {}

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MESSAGE = "Diana's port-side back bench cushion is cracked and the foam is coming out — needs replacing before the weekend. Also the cup holder next to it is loose."
const PHOTO_DESCRIPTION = 'A cracked black bench cushion on a boat, with yellow foam visible through a split seam along the edge.'

async function main() {
  console.log('━━━ Maintenance agent — live demo ━━━\n')
  console.log('Simulated Slack post (#maintenance-and-ideas):')
  console.log(`  "${MESSAGE}"`)
  console.log(`  📷 [photo] → Gemini would describe: "${PHOTO_DESCRIPTION}"\n`)

  const { data: boats } = await supabase.from('boats').select('id, name')
  const boatNames = (boats ?? []).map(b => b.name).join(', ')

  console.log('Running Claude (classify + draft technician email)...')
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are the shadow maintenance assistant for Off Course Amsterdam (electric canal boats: ${boatNames}). Someone posted this in the "Maintenance and Ideas" channel. SHADOW mode — nothing is sent.

Classify it (idea/suggestion/task), write a short title + clean summary, and draft a friendly concise email to our technician asking for an estimate. Sign off "Off Course Amsterdam".

MESSAGE (from Jannah):
${MESSAGE}

PHOTOS (AI descriptions):
1. ${PHOTO_DESCRIPTION}

Return JSON only:
{"classification":"idea|suggestion|task","title":"...","summary":"...","boat":"<${boatNames}, or null>","email_subject":"...","email_body":"...","reasoning":"..."}`,
    }],
  })
  const text = resp.content[0]?.type === 'text' ? resp.content[0].text : ''
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
  console.log(`  ✓ Classified as: ${parsed.classification}\n`)

  const boatId = (boats ?? []).find(b => b.name.toLowerCase() === String(parsed.boat).toLowerCase())?.id ?? null
  const eventId = `demo-${Date.now()}`

  // Insert the board record (exercises text[] columns + CHECK constraints).
  const { data: task, error: taskErr } = await supabase
    .from('maintenance_tasks')
    .insert({
      boat_id: boatId,
      title: parsed.title,
      description: parsed.summary,
      classification: parsed.classification,
      status: 'open',
      photo_urls: [],
      photo_descriptions: [PHOTO_DESCRIPTION],
      source: 'slack',
      source_slack_event_id: eventId,
      source_channel: 'maintenance-and-ideas',
      reporter: 'Jannah',
    })
    .select('id')
    .single()
  if (taskErr || !task) { console.error('task insert failed:', taskErr); process.exit(1) }
  console.log(`  ✓ maintenance_tasks row: ${task.id}`)

  // Insert the Ghost email proposal (shadow).
  const { data: proposal, error: pErr } = await supabase
    .from('agent_proposals')
    .insert({
      kind: 'maintenance_task',
      status: 'shadow',
      model: 'claude-sonnet-4-6',
      reasoning: parsed.reasoning,
      payload: {
        maintenance_task_id: task.id,
        classification: parsed.classification,
        title: parsed.title,
        summary: parsed.summary,
        photo_descriptions: [PHOTO_DESCRIPTION],
        email_subject: parsed.email_subject,
        email_body: parsed.email_body,
        recipient: process.env.MAINTENANCE_EMAIL_RECIPIENT ?? null,
      },
    })
    .select('id')
    .single()
  if (pErr || !proposal) { console.error('proposal insert failed:', pErr); process.exit(1) }
  await supabase.from('maintenance_tasks').update({ proposal_id: proposal.id }).eq('id', task.id)
  console.log(`  ✓ agent_proposals row: ${proposal.id} (shadow)\n`)

  console.log('━━━ Drafted technician email ━━━')
  console.log(`Subject: ${parsed.email_subject}`)
  console.log('┌─────────────────────────────────────────────────────────────')
  String(parsed.email_body).split('\n').forEach((l: string) => console.log('│ ' + l))
  console.log('└─────────────────────────────────────────────────────────────')
  console.log('\nView it:')
  console.log('  • Ghost dashboard (approve & send): http://localhost:3000/en/admin/ghost')
  console.log('  • Maintenance board:                http://localhost:3000/en/admin/maintenance')
}

main().catch(e => { console.error(e); process.exit(1) })

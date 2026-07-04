/**
 * Adds a follow-up message from Lisa + a new Ghost draft for it.
 * The draft will be slightly "off" so the admin can correct it — demonstrating the learning loop.
 * Run: npx tsx scripts/add-lisa-followup.ts
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
const CONVO_ID = 'dfc61a47-2330-4f2b-ba5d-5ee57d1b214f'

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'submit_reply_draft',
    description: 'Finish by submitting the reply you would send to the customer.',
    input_schema: {
      type: 'object',
      properties: {
        reply: { type: 'string' },
        language: { type: 'string' },
        reasoning: { type: 'string' },
        open_question: { type: ['string', 'null'] },
      },
      required: ['reply', 'language', 'reasoning'],
    },
  },
]

async function main() {
  // 1. Add follow-up message from Lisa
  const { data: msg } = await supabase
    .from('messages')
    .insert({
      conversation_id: CONVO_ID,
      direction: 'in',
      author_name: 'Lisa van Dijk',
      body: 'Super! Nog een vraagje: hoe laat moeten we er zijn? En zijn er dingen die we zelf mee moeten nemen?',
    })
    .select('id')
    .single()
  console.log('✓ Message inserted:', msg?.id)

  // 2. Generate Ghost draft (agent doesn't know exact arrival policy → should use open_question)
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `You are the shadow inbox agent for Off Course Amsterdam. Reply to the latest message.

CUSTOMER: Lisa van Dijk | nl | Today: 2026-06-14 (Amsterdam)

CONVERSATION:
CUSTOMER: Hi! We boeken een privécruise op zaterdag met 6 personen. Welke eten en drinken kunnen we regelen?
OFF COURSE: Hey Lisa! Je hebt de Bites Box Large (€65) en Unlimited Drinks (€10,80 p.p./uur) — perfect voor 6 mensen. Champagne meebrengen kan ook: BYO-optie is €5 p.p., wij koelen de flessen.
CUSTOMER: Super! Nog een vraagje: hoe laat moeten we er zijn? En zijn er dingen die we zelf mee moeten nemen?

THINGS THE TEAM HAS TAUGHT YOU:
- Q: What time should guests arrive before departure?
  A: We ask guests to arrive 10 minutes before departure time. The skipper does a quick safety briefing.

RULES
- Reply in Dutch, chat-length (2-3 sentences max), warm casual Off Course voice.
- Arrival: 10 minutes before departure — this is in the taught knowledge above.
- Things to bring: keep it simple, no special gear needed. They can bring their own drinks (BYO). Comfortable shoes mentioned if relevant.
- Don't be too formal or list-heavy. Keep it conversational.`,
  }]

  let submission: Record<string, unknown> | null = null
  for (let i = 0; i < 4; i++) {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 512,
      system: 'Off Course Amsterdam inbox co-pilot. Warm, casual Dutch brand voice. Never corporate.',
      tools: TOOLS, messages,
    })
    messages.push({ role: 'assistant', content: resp.content })
    if (resp.stop_reason === 'tool_use') {
      for (const b of resp.content) {
        if (b.type === 'tool_use' && b.name === 'submit_reply_draft') {
          submission = b.input as Record<string, unknown>
          break
        }
      }
      if (submission) break
    } else break
  }

  if (!submission?.reply) { console.error('No submission'); process.exit(1) }

  // 3. Insert the proposal
  const { data: prop } = await supabase
    .from('agent_proposals')
    .insert({
      kind: 'reply_draft',
      conversation_id: CONVO_ID,
      trigger_message_id: msg?.id ?? null,
      status: 'shadow',
      reasoning: submission.reasoning as string,
      model: 'claude-sonnet-4-6',
      payload: {
        reply: submission.reply,
        language: submission.language ?? 'nl',
        open_question: submission.open_question ?? null,
        steps: [],
      },
    })
    .select('id')
    .single()

  console.log('✓ Proposal inserted:', prop?.id)
  console.log('\n👻 Ghost draft (Dutch):')
  console.log((submission.reply as string).split('\n').map(l => '  ' + l).join('\n'))
  if (submission.open_question) {
    console.log('\n⚠️  Open question flagged:', submission.open_question)
  }
  console.log('\nNow: open /admin/inbox → find Lisa → see new Ghost card → type a DIFFERENT reply and send it.')
  console.log('The correction will be saved to agent_proposals.outcome for future learning.')
}

main().catch(e => { console.error(e); process.exit(1) })

/**
 * Seeds a fake "Lisa van Dijk — catering question" conversation into the DB,
 * then generates a real Ghost co-pilot proposal via the Anthropic API.
 *
 * After running, open /admin/inbox in the browser to see the co-pilot card.
 * Run: npx tsx scripts/seed-lisa-conversation.ts
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load env BEFORE any imports that might validate it
try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
} catch { /* rely on existing env */ }

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Tools (same as shadow-drafter + buildGhostTools) ─────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_extras',
    description: "List the food & drinks a cruise offers — bites boxes, drinks packages, platters — with real prices. Call when a customer asks what snacks/food/drinks/catering are available.",
    input_schema: { type: 'object', properties: { listing_slug: { type: 'string' } }, required: ['listing_slug'] },
  },
  {
    name: 'get_customer_bookings',
    description: "Look up a customer's booking history by email.",
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
  },
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

// Fetch the real menu from DB
async function fetchExtrasMenu(listingSlug: string): Promise<unknown> {
  const { data: listing } = await supabase
    .from('cruise_listings')
    .select('id, category')
    .eq('slug', listingSlug)
    .maybeSingle()

  if (!listing) {
    // Fall back to a realistic stub if slug doesn't exist
    return {
      menu: [
        { name: 'Bites Box Small',   category: 'food',   price: '€20.00', about: 'Olives, cheese & charcuterie — 1-2 people' },
        { name: 'Bites Box Medium',  category: 'food',   price: '€35.00', about: 'Expanded spread — 3-4 people' },
        { name: 'Bites Box Large',   category: 'food',   price: '€65.00', about: 'Full spread — groups of 6+' },
        { name: 'Unlimited Drinks',  category: 'drinks', price: '€10.80 per person per hour' },
        { name: 'Bring Your Own',    category: 'drinks', price: '€5.00 per person', about: 'We chill your bottles' },
      ],
      note: 'Choose these at checkout on the booking page. No payment until the day.',
    }
  }

  const { data: extras } = await supabase
    .from('extras')
    .select('id, name, description, category, price_type, price_value, min_people, applicable_categories, scope')
    .eq('is_active', true)
    .in('category', ['food', 'drinks'])
    .order('sort_order', { ascending: true })

  const { data: listingExtraIds } = await supabase
    .from('listing_extras')
    .select('extra_id')
    .eq('listing_id', listing.id)
    .eq('is_enabled', true)
  const perListing = new Set((listingExtraIds ?? []).map((r: { extra_id: string }) => r.extra_id))

  const available = (extras ?? []).filter((e: { scope: string; id: string; applicable_categories: string[] | null }) => {
    if (e.scope === 'per_listing') return perListing.has(e.id)
    const cats = e.applicable_categories as string[] | null
    return !cats || cats.includes(listing.category ?? '') || cats.includes('private')
  })

  function fmtPrice(t: string, v: number): string {
    const eur = (v / 100).toFixed(2)
    if (t === 'fixed_cents') return `€${eur}`
    if (t === 'per_person_cents') return `€${eur} per person`
    if (t === 'per_person_per_hour_cents') return `€${eur} per person per hour`
    return ''
  }

  return {
    menu: available.map((e: { name: string; category: string; price_type: string; price_value: number; description?: string | null; min_people?: number | null }) => ({
      name: e.name,
      category: e.category,
      ...(fmtPrice(e.price_type, e.price_value) ? { price: fmtPrice(e.price_type, e.price_value) } : {}),
      ...(e.description ? { about: e.description.slice(0, 100) } : {}),
      ...(e.min_people ? { for_at_least: e.min_people } : {}),
    })),
    note: 'Choose these at checkout on the booking page. No payment until the day.',
  }
}

async function main() {
  console.log('━━━ Seeding Lisa van Dijk conversation ━━━\n')

  // 1. Upsert contact
  console.log('1. Creating contact...')
  const { data: contact, error: cErr } = await supabase
    .from('contacts')
    .upsert({ name: 'Lisa van Dijk', email: 'lisa.vandijk.test@offcourseamsterdam.com', locale: 'nl', notes: 'Test contact — seeded by seed-lisa-conversation.ts' }, { onConflict: 'email' })
    .select('id, name, email')
    .single()
  if (cErr || !contact) { console.error('Contact error:', cErr); process.exit(1) }
  console.log(`   ✓ Contact: ${contact.name} (${contact.id})`)

  // 2. Create conversation
  console.log('2. Creating conversation...')
  const { data: convo, error: cvErr } = await supabase
    .from('conversations')
    .insert({ contact_id: contact.id, channel: 'webchat', subject: 'Catering vraag — private cruise zaterdag', status: 'open' })
    .select('id')
    .single()
  if (cvErr || !convo) { console.error('Conversation error:', cvErr); process.exit(1) }
  console.log(`   ✓ Conversation: ${convo.id}`)

  // 3. Seed messages
  console.log('3. Adding messages...')
  const msgs = [
    { conversation_id: convo.id, direction: 'in',  author_name: 'Lisa van Dijk', body: "Hi! We boeken een privécruise op zaterdag met 6 personen — super excited! Snelle vraag: welke eten en drinken kunnen we regelen? Is er een snackoptie of drankenpakket?" },
    { conversation_id: convo.id, direction: 'out', author_name: 'Team Off Course', body: "Hey Lisa! Gefeliciteerd met de boeking — 6 mensen op zaterdag wordt top. Ik check even wat we voor je kunnen doen op het catering front." },
    { conversation_id: convo.id, direction: 'in',  author_name: 'Lisa van Dijk', body: "Tof! En is er ook een 'bring your own' optie voor dranken? We willen misschien wat Champagne meenemen." },
  ]
  const { error: mErr } = await supabase.from('messages').insert(msgs)
  if (mErr) { console.error('Messages error:', mErr); process.exit(1) }
  console.log(`   ✓ ${msgs.length} messages inserted`)

  // Find the last inbound message id (for trigger_message_id)
  const { data: lastMsg } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', convo.id)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // 4. Fetch the real menu from DB
  console.log('4. Fetching real extras menu from DB...')
  const menu = await fetchExtrasMenu('private-hidden-gems-cruise')
  console.log(`   ✓ Menu fetched`)

  // 5. Run the real agent loop to get a reply draft
  console.log('5. Running Ghost agent loop (real Claude API)...')

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `You are the shadow inbox agent for Off Course Amsterdam. Investigate, then call submit_reply_draft.

CUSTOMER
- Name: Lisa van Dijk
- Email: lisa.vandijk.test@offcourseamsterdam.com
- Locale: nl (Dutch)
- Today is 2026-06-14 (Amsterdam)

CONVERSATION SO FAR
CUSTOMER (Lisa van Dijk): Hi! We boeken een privécruise op zaterdag met 6 personen — super excited! Snelle vraag: welke eten en drinken kunnen we regelen? Is er een snackoptie of drankenpakket?
OFF COURSE (team): Hey Lisa! Gefeliciteerd met de boeking — 6 mensen op zaterdag wordt top. Ik check even wat we kunnen doen op het catering front.
CUSTOMER (Lisa van Dijk): Tof! En is er ook een 'bring your own' optie voor dranken? We willen misschien wat Champagne meenemen.

RULES
- Reply in DUTCH, chat-length (2-4 sentences max unless listing items), Off Course brand voice: warm, casual, dry humour, no corporate speak.
- The customer is asking about food/drinks options. You already have the menu below — no need to call list_extras.
- Never invent items or prices — use only what is in the menu.
- Tell them they can choose at checkout on the booking page; no payment until the day.

MENU (already fetched):
${JSON.stringify(menu, null, 2)}`,
    },
  ]

  let submission: Record<string, unknown> | null = null
  let stepCount = 0

  while (stepCount < 5) {
    stepCount++
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: 'You are the Off Course Amsterdam inbox co-pilot. Brand voice: "your friend with a boat". Warm, casual, dry Amsterdam humour. No corporate speak.',
      tools: TOOLS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'tool_use') {
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        if (block.name === 'submit_reply_draft') {
          submission = block.input as Record<string, unknown>
          break
        }
        if (block.name === 'get_customer_bookings') {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ bookings: [], note: 'No bookings found.' }) })
        }
        if (block.name === 'list_extras') {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(menu) })
        }
      }
      if (submission) break
      if (results.length) messages.push({ role: 'user', content: results })
    } else {
      break
    }
  }

  if (!submission?.reply) { console.error('Agent did not submit a reply'); process.exit(1) }
  console.log(`   ✓ Draft generated in ${stepCount} turn(s)`)

  // 6. Insert the proposal into agent_proposals
  console.log('6. Inserting Ghost proposal...')
  const { data: proposal, error: pErr } = await supabase
    .from('agent_proposals')
    .insert({
      kind: 'reply_draft',
      conversation_id: convo.id,
      trigger_message_id: lastMsg?.id ?? null,
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
  if (pErr || !proposal) { console.error('Proposal error:', pErr); process.exit(1) }
  console.log(`   ✓ Proposal inserted (${proposal.id})`)

  console.log(`
━━━ Done! ━━━

Open the admin inbox and find this conversation:
  → http://localhost:3000/admin/inbox

Contact:   Lisa van Dijk
Subject:   Catering vraag — private cruise zaterdag
Co-pilot:  Look for the Ghost card in the right pane 👻

Draft reply (Dutch):
┌─────────────────────────────────────────────────────────────`)
  ;(submission.reply as string).split('\n').forEach(l => console.log('│ ' + l))
  console.log(`└─────────────────────────────────────────────────────────────
Reasoning: ${submission.reasoning}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

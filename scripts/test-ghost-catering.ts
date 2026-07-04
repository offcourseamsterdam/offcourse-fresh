/**
 * Live demo: Ghost inbox agent responding to a catering question.
 *
 * Calls the real Anthropic API (metered) but uses stub tools so no DB/FH needed.
 * Run: npx tsx scripts/test-ghost-catering.ts
 *
 * The script uses the Anthropic SDK directly to show:
 *   - The 5 inbox agent tools and their descriptions
 *   - The real agent loop (tool calls → Claude reasoning → draft reply)
 *   - The final Dutch reply + its English reasoning
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import Anthropic from '@anthropic-ai/sdk'

// Load env before anything validates it
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

// ── Tool definitions (same as buildGhostTools + shadow-drafter) ─────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_availability',
    description: 'Check REAL FareHarbor availability for a date and group size — every published cruise with its open departure times and prices. Call this whenever a customer mentions a date, wants to book, rebook or asks "is X free". Do not guess availability; this is the only source of truth.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, guests: { type: 'number' } }, required: ['date', 'guests'] },
  },
  {
    name: 'get_customer_bookings',
    description: "Look up a customer's booking history by email — dates, cruises, party sizes, status, catering extras. Call when you need to know if/what they booked.",
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
  },
  {
    name: 'check_booking',
    description: 'Before you PROPOSE or PROMISE a specific booking, call this to confirm FareHarbor would actually accept it. Returns { bookable: true } or { bookable: false, alternatives[] }.',
    input_schema: { type: 'object', properties: { listing_slug: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, guests: { type: 'number' }, option: { type: 'string' } }, required: ['listing_slug', 'date', 'time', 'guests'] },
  },
  {
    name: 'list_extras',
    description: "List the food & drinks a cruise offers — bites boxes, drinks packages, platters — with real prices. Call when a customer asks what snacks/food/drinks/catering are available or what they can add. Returns a menu. Tell them these are chosen at checkout on the booking page (no payment until the day); never invent items or prices.",
    input_schema: { type: 'object', properties: { listing_slug: { type: 'string', description: 'The cruise slug from search_availability' } }, required: ['listing_slug'] },
  },
  {
    name: 'submit_reply_draft',
    description: 'Finish by submitting the reply you would send to the customer.',
    input_schema: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: "The reply, in the customer's language. Chat-length." },
        language: { type: 'string' },
        reasoning: { type: 'string', description: '1-2 sentences in English: why this reply' },
        open_question: { type: ['string', 'null'] },
      },
      required: ['reply', 'language', 'reasoning'],
    },
  },
]

// ── Stub tool executor ────────────────────────────────────────────────────────

function executeTool(name: string, input: Record<string, unknown>): unknown {
  if (name === 'list_extras') {
    // Real menu data (mirrors what the DB would return for a private cruise)
    return {
      menu: [
        { name: 'Bites Box Small', category: 'food', price: '€20.00', about: 'Olives, cheese & charcuterie — great for 1-2 people' },
        { name: 'Bites Box Medium', category: 'food', price: '€35.00', about: 'Expanded bites selection — ideal for 3-4 people' },
        { name: 'Bites Box Large', category: 'food', price: '€65.00', about: 'Full spread — perfect for groups of 6+' },
        { name: 'Unlimited Drinks Package', category: 'drinks', price: '€10.80 per person per hour' },
        { name: 'Bring Your Own Drinks', category: 'drinks', price: '€5.00 per person', about: 'We chill your own bottles for you' },
      ],
      note: "Customers choose these at checkout on the booking page (or pre-order from their confirmation). No payment is taken until the day.",
    }
  }
  if (name === 'search_availability') {
    return { available: true, listings: [{ listing: 'Private Hidden Gems Cruise', slug: 'private-hidden-gems-cruise', category: 'private', times: ['5pm', '6pm', '7pm'], options: [{ name: 'Diana - 2 Hours', price_eur: 350, duration_min: 120 }] }] }
  }
  return { note: 'stubbed', input }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  console.log('\n━━━ Ghost Inbox Agent — Available Tools ━━━\n')
  TOOLS.filter(t => t.name !== 'submit_reply_draft').forEach(t => {
    console.log(`  • ${t.name}`)
    console.log(`    ${(t.description ?? '').slice(0, 100)}...\n`)
  })

  console.log('━━━ Test Scenario ━━━\n')
  console.log('  Customer: Lisa van Dijk — private cruise, 6 people, Saturday')
  console.log('  Message:  "Hi! What food and drinks can we arrange? Is there a Bring Your Own option for Champagne?"\n')

  console.log('━━━ Running agent loop (real Claude API) ━━━\n')

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `You are the shadow inbox agent for Off Course Amsterdam. A customer sent a chat message; investigate what you need (tools), then call submit_reply_draft with your reply.

CUSTOMER
- Name: Lisa van Dijk
- Email: lisa@example.com
- Locale: nl (Dutch)
- Today is 2026-06-14 (Amsterdam)

CONVERSATION SO FAR
CUSTOMER (Lisa van Dijk): Hi! We're booking a private cruise on Saturday for 6 people — super excited! Quick question: what kind of food and drinks can we arrange? Is there like a snack option or drinks package?
OFF COURSE (team): Hey Lisa! Congrats on the booking — 6 people on a Saturday is going to be great. Let me check what we can do for you on the catering front.
CUSTOMER (Lisa van Dijk): Awesome! Also, is there like a "bring your own" option for drinks? We might want to bring some Champagne.

RULES
- Reply in DUTCH, chat-length, Off Course brand voice: warm, casual, dry humour.
- Food/drinks/catering questions: call list_extras with the cruise slug for the real menu. Tell them items are chosen at checkout on the booking page; no payment until the day. Never invent menu items or prices.
- Use listing_slug "private-hidden-gems-cruise" for this cruise.
- Only call submit_reply_draft when you have the real menu from list_extras.`,
    },
  ]

  let stepCount = 0
  const steps: Array<{ tool: string; input: unknown; result: unknown }> = []

  // Agent loop
  while (stepCount < 6) {
    stepCount++

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: 'You are the Off Course Amsterdam inbox co-pilot. Brand voice: "your friend with a boat". Warm, casual, dry Amsterdam humour. No corporate speak.',
      tools: TOOLS,
      messages,
    })

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        const input = block.input as Record<string, unknown>
        console.log(`  [Step ${stepCount}] → ${block.name}(${JSON.stringify(input).slice(0, 80)})`)

        if (block.name === 'submit_reply_draft') {
          // Terminal tool — exit the loop
          console.log()
          const sub = block.input as { reply: string; language: string; reasoning: string; open_question?: string | null }
          console.log('━━━ Final Submission ━━━\n')
          console.log(`Language detected: ${sub.language}`)
          console.log(`Reasoning: ${sub.reasoning}`)
          if (sub.open_question) console.log(`Open question: ${sub.open_question}`)
          console.log(`\nDRAFT REPLY (in the customer's language — Dutch):\n`)
          console.log('┌─────────────────────────────────────────────────────────────')
          sub.reply.split('\n').forEach(l => console.log('│ ' + l))
          console.log('└─────────────────────────────────────────────────────────────')
          console.log(`\nSteps taken: ${steps.length + 1} tool calls over ${stepCount} turns`)
          return
        }

        const result = executeTool(block.name, input)
        console.log(`         ← ${JSON.stringify(result).slice(0, 120)}`)

        steps.push({ tool: block.name, input, result })
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }

      if (toolResults.length) {
        messages.push({ role: 'user', content: toolResults })
      }
    }
  }

  console.log('\n⚠️  Loop ended without submit_reply_draft (hit turn limit)')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

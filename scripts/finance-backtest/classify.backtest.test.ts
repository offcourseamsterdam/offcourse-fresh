/**
 * Backtest of automatic bank-transaction classification against Beer's own
 * decisions. Read-only: SELECTs via the Supabase Management API, model calls
 * via Anthropic, nothing is written anywhere.
 *
 * Replays every transaction Beer classified by hand in date order. For each
 * one the classifier only knows what he had classified BEFORE it — so this
 * measures what it would really have done, not what it can do with hindsight.
 *
 * Opt-in; self-skips in `npm test`:
 *   FINANCE_BACKTEST=1 npx vitest run scripts/finance-backtest
 * Knobs: FINANCE_BACKTEST_MODELS (comma list; default Haiku 4.5 + Sonnet 5).
 * Writes scripts/finance-backtest/out/report.txt (gitignored).
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { classifyByHistory, examplesFor, historyKey, type PastClassification } from '@/lib/finance/cockpit/classify/history'
import { buildPrompt, parseAiAnswer, validateAiAnswer, type AiCorrectionExample } from '@/lib/finance/cockpit/classify/ai'
import type { ClassifiableTransaction } from '@/lib/finance/cockpit/classify/rules'

const RUN = process.env.FINANCE_BACKTEST === '1'
const MODELS = (process.env.FINANCE_BACKTEST_MODELS ?? 'claude-haiku-4-5,claude-sonnet-5').split(',').map(s => s.trim())
const OUT = path.join(process.cwd(), 'scripts/finance-backtest/out')

function envFromFile(name: string): string {
  const file = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  const m = file.match(new RegExp(`^${name}=(.*)$`, 'm'))
  if (!m) throw new Error(`${name} not found in .env.local`)
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function sql<T>(token: string, query: string): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('backtest only runs SELECTs')
  const res = await fetch('https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error(`query failed: ${JSON.stringify(json).slice(0, 300)}`)
  return json as T[]
}

interface Row {
  id: string
  revolut_id: string
  type: string
  state: string
  amount_cents: number
  fee_cents: number
  created_at: string
  reviewed_at: string | null
  reference: string | null
  description: string | null
  counterparty: { id?: string; account_id?: string; account_type?: string; name?: string } | null
  merchant: { name?: string; category_code?: string } | null
  category: string
  subcategory: string | null
  boat_id: string | null
  goal_id: string | null
  obligation_id: string | null
  loan_payment_id: string | null
}

const toTx = (r: Row): ClassifiableTransaction => ({
  id: r.id,
  revolutId: r.revolut_id,
  type: r.type,
  state: r.state,
  amountCents: r.amount_cents,
  feeCents: r.fee_cents,
  createdAt: r.created_at,
  reference: r.reference,
  description: r.description,
  counterpartyName: r.counterparty?.name ?? null,
  counterpartyId: r.counterparty?.id ?? r.counterparty?.account_id ?? null,
  counterpartyAccountType: r.counterparty?.account_type ?? null,
  merchantName: r.merchant?.name ?? null,
  merchantCategoryCode: r.merchant?.category_code ?? null,
})

const toPast = (r: Row): PastClassification => ({
  key: historyKey(toTx(r)),
  amountCents: r.amount_cents,
  category: r.category,
  subcategory: r.subcategory,
  boatId: r.boat_id,
  goalId: r.goal_id,
  obligationId: r.obligation_id,
  loanPaymentId: r.loan_payment_id,
  label: r.description ?? r.merchant?.name ?? '',
  reviewedAt: r.reviewed_at,
})

const toExample = (p: PastClassification): AiCorrectionExample => ({ label: p.label, amountCents: p.amountCents, category: p.category, subcategory: p.subcategory })

async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i]() }
  }))
  return out
}

interface AiResult { category: string | null; subcategory: string | null; confidence: number }

describe.skipIf(!RUN)('finance classification backtest', () => {
  it('replays Beer’s decisions', { timeout: 40 * 60_000 }, async () => {
    const token = envFromFile('SUPABASE_MANAGEMENT_TOKEN')
    const claude = new Anthropic({ apiKey: envFromFile('ANTHROPIC_API_KEY') })
    const real = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.hostname !== 'api.anthropic.com' && url.hostname !== 'api.supabase.com') throw new Error(`blocked ${url.hostname}`)
      return real(input, init)
    }) as typeof fetch

    const rows = await sql<Row>(token, `select id, revolut_id, type, state, amount_cents, fee_cents, created_at, reviewed_at, reference, description, counterparty, merchant, category, subcategory, boat_id, goal_id, obligation_id, loan_payment_id from bank_transactions where classified_by = 'user' and category is not null order by created_at`)
    const boats = await sql<{ id: string; name: string }>(token, `select id, name from boats where is_active`)

    const call = (model: string) => async (prompt: string): Promise<AiResult> => {
      const res = await claude.messages.create({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
      const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('')
      return { category: null, subcategory: null, confidence: 0, ...(() => {
        const parsed = parseAiAnswer(text)
        return parsed ? { category: parsed.category, subcategory: parsed.subcategory, confidence: parsed.confidence } : {}
      })() }
    }

    // Case setup: what each variant knows at the time of each transaction.
    const cases = rows.map((r, i) => {
      const tx = toTx(r)
      const past = rows.slice(0, i).map(toPast)
      const oldExamples = [...past].sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '')).slice(0, 20).map(toExample)
      const newExamples = examplesFor(tx, past).map(toExample)
      return { r, tx, history: classifyByHistory(tx, past), oldPrompt: buildPrompt(tx, { boats, recentCorrections: oldExamples }), newPrompt: buildPrompt(tx, { boats, recentCorrections: newExamples }) }
    })

    const aiCases = cases.filter(c => !c.history)
    const variants: { name: string; run: (c: (typeof cases)[number]) => Promise<AiResult> }[] = [
      { name: 'today: Haiku + last 20 corrections', run: c => call('claude-haiku-4-5')(c.oldPrompt) },
      ...MODELS.map(m => ({ name: `new: ${m} + this counterparty's history first`, run: (c: (typeof cases)[number]) => call(m)(c.newPrompt) })),
    ]

    const lines: string[] = []
    const hist = cases.filter(c => c.history)
    const histCatOk = hist.filter(c => c.history!.category === c.r.category).length
    const histFullOk = hist.filter(c => c.history!.category === c.r.category && (c.history!.subcategory ?? null) === (c.r.subcategory ?? null)).length
    lines.push(`Transactions Beer classified by hand: ${rows.length}`)
    lines.push('')
    lines.push(`HISTORY LAYER (applies automatically): fired on ${hist.length}/${rows.length}`)
    lines.push(`  category right: ${histCatOk}/${hist.length} · category + subcategory right: ${histFullOk}/${hist.length}`)
    for (const c of hist) if (c.history!.category !== c.r.category || (c.history!.subcategory ?? null) !== (c.r.subcategory ?? null)) {
      lines.push(`  MISS: said ${c.history!.category}/${c.history!.subcategory}, Beer said ${c.r.category}/${c.r.subcategory} (€${(c.r.amount_cents / 100).toFixed(2)})`)
    }
    lines.push('')
    lines.push(`AI on the other ${aiCases.length} (what history couldn't place):`)

    for (const v of variants) {
      const results = await pool(aiCases.map(c => async () => {
        try {
          const ai = await v.run(c)
          const validated = validateAiAnswer(ai.category ? { category: ai.category, subcategory: ai.subcategory, boat_id: null, confidence: ai.confidence, reason: '' } : null, c.tx, boats)
          return { c, ai: validated, confidence: validated?.confidence ?? 0 }
        } catch (err) {
          return { c, ai: null, confidence: 0, error: (err as Error).message }
        }
      }), 6)
      const bucket = (lo: number, hi: number) => {
        const inB = results.filter(r => r.confidence >= lo && r.confidence < hi)
        const cat = inB.filter(r => r.ai && r.ai.category === r.c.r.category).length
        const full = inB.filter(r => r.ai && r.ai.category === r.c.r.category && (r.ai.subcategory ?? null) === (r.c.r.subcategory ?? null)).length
        return `${inB.length.toString().padStart(3)} tx · category right ${cat}/${inB.length} · cat+sub right ${full}/${inB.length}`
      }
      const cat = results.filter(r => r.ai && r.ai.category === r.c.r.category).length
      const full = results.filter(r => r.ai && r.ai.category === r.c.r.category && (r.ai.subcategory ?? null) === (r.c.r.subcategory ?? null)).length
      lines.push('')
      lines.push(`  ${v.name}`)
      lines.push(`    overall: category right ${cat}/${results.length} · cat+sub right ${full}/${results.length}`)
      lines.push(`    confidence ≥0.9 (auto-applied): ${bucket(0.9, 1.01)}`)
      lines.push(`    confidence 0.6–0.9 (suggested):  ${bucket(0.6, 0.9)}`)
      lines.push(`    confidence <0.6 (left for you):  ${bucket(0, 0.6)}`)
      const errors = results.filter(r => 'error' in r && r.error).length
      if (errors) lines.push(`    errors: ${errors}`)
    }

    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'report.txt'), lines.join('\n') + '\n')
  })
})

/**
 * Dry run on the transactions waiting right now: what the pipeline's history
 * and AI layers WOULD do, written to out/preview.txt. Read-only — nothing is
 * classified. (The structural rules and learned rules run first in the real
 * pipeline; this preview skips them, so a row they'd catch may show an AI
 * answer here instead.)
 *   FINANCE_BACKTEST_PREVIEW=1 npx vitest run scripts/finance-backtest
 */
describe.skipIf(process.env.FINANCE_BACKTEST_PREVIEW !== '1')('preview on pending transactions', () => {
  it('shows what would happen', { timeout: 10 * 60_000 }, async () => {
    const token = envFromFile('SUPABASE_MANAGEMENT_TOKEN')
    const claude = new Anthropic({ apiKey: envFromFile('ANTHROPIC_API_KEY') })
    const cols = 'id, revolut_id, type, state, amount_cents, fee_cents, created_at, reviewed_at, reference, description, counterparty, merchant, category, subcategory, boat_id, goal_id, obligation_id, loan_payment_id'
    const past = (await sql<Row>(token, `select ${cols} from bank_transactions where classified_by = 'user' and category is not null`)).map(toPast)
    const pending = await sql<Row>(token, `select ${cols} from bank_transactions where category is null order by created_at`)
    const boats = await sql<{ id: string; name: string }>(token, `select id, name from boats where is_active`)
    const lines: string[] = []
    for (const r of pending) {
      const tx = toTx(r)
      const label = `${r.created_at.slice(0, 10)} €${(r.amount_cents / 100).toFixed(2).padStart(9)} ${r.state.padEnd(9)} ${(r.description ?? r.merchant?.name ?? '').slice(0, 40)}`
      if (r.state !== 'completed') { lines.push(`${label}\n    → not completed yet, waits`); continue }
      const h = classifyByHistory(tx, past)
      if (h) { lines.push(`${label}\n    → HISTORY, applied: ${h.category}/${h.subcategory} — ${h.reason}`); continue }
      const prompt = buildPrompt(tx, { boats, recentCorrections: examplesFor(tx, past).map(toExample) })
      const res = await claude.messages.create({ model: 'claude-sonnet-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
      const ai = validateAiAnswer(parseAiAnswer(res.content.map(b => (b.type === 'text' ? b.text : '')).join('')), tx, boats)
      const what = !ai ? 'no usable answer → left for you' : ai.confidence >= 0.9 ? 'AI, applied' : ai.confidence >= 0.6 ? 'AI, suggested for your review' : 'AI unsure → left for you'
      lines.push(`${label}\n    → ${what}${ai ? `: ${ai.category}/${ai.subcategory} (${ai.confidence.toFixed(2)}) — ${ai.reason}` : ''}`)
    }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'preview.txt'), lines.join('\n') + '\n')
  })
})

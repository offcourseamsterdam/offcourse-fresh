/**
 * Hand the original document to the bookkeeper (plan §5, PRD §9).
 *
 * SnelStart's mailbox (SNELSTART_INBOX_EMAIL) reads whatever lands in it, so
 * forwarding is nothing more than an e-mail with the invoice/receipt attached
 * and the facts we already know in the body. Two rules carry the weight:
 *
 *   written once  — a record is CLAIMED (snelstart_sent_at set, only if null)
 *                   before anything is sent, so the hourly cron and a manual
 *                   click can never both send; a failed send releases the claim.
 *   original only — the file that was received goes out, never a rendering of
 *                   our own extraction; the body is context, the PDF is truth.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { downloadFinanceAttachment } from '@/lib/finance/attachment-storage'
import { sendNewEmail } from '@/lib/gmail/client'
import { postSlackOps } from '@/lib/slack/send-notification'
import { recomputeExpense, type DocumentRow, type ExpenseRow } from './recompute'
import { AUTO_FORWARD_STATUSES } from './status'

type Admin = ReturnType<typeof createAdminClient>

/** Per hourly run. Each record is a storage download + a Gmail send with a multi-MB attachment; keep the cron well inside its 60 s. */
export const FORWARD_BATCH_LIMIT = 10
/** A claim older than this with nothing sent is a crashed run, not a send in progress. */
export const STALE_CLAIM_MINUTES = 15

/**
 * The bookkeeper's mailbox, from the environment only. No hardcoded fallback:
 * a preview deployment without the variable must never mail real documents
 * to the real bookkeeper (the same lesson as the old hardcoded Slack DM id).
 */
export function snelstartRecipient(): string | null {
  const v = process.env.SNELSTART_INBOX_EMAIL?.trim()
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
}

const KIND_LABEL: Record<string, string> = {
  invoice_pdf: 'factuur (PDF)',
  invoice_link: 'factuur (gedownload via link)',
  receipt_image: 'bon (foto)',
  revolut_receipt: 'bon (Revolut)',
  order_confirmation_email: 'orderbevestiging',
}

export interface ForwardEmail {
  to: string
  subject: string
  body: string
  attachmentFilename: string
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-'
}

/** Plain ASCII money for a mail body that a bookkeeping scanner will read: "EUR 121,00", no € sign, no non-breaking space. */
function formatCurrency(euros: number): string {
  const [int, frac] = Math.abs(euros).toFixed(2).split('.')
  return `${euros < 0 ? '-' : ''}EUR ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac}`
}

/**
 * Subject and body the bookkeeper sees. ASCII hyphens only in the subject —
 * an em-dash there showed up as mojibake in a mail client once (commit
 * 79dc249), and the bookkeeper's tooling may be no better.
 */
export function buildForwardEmail(expense: ExpenseRow, doc: DocumentRow, recipient: string): ForwardEmail {
  const supplier = expense.supplier_name ?? 'Onbekende leverancier'
  const numberOrDate = expense.invoice_number ?? fmtDate(expense.invoice_date ?? expense.paid_at)
  const subject = `[${expense.ref}] ${supplier} - ${numberOrDate}`.replace(/[^\x20-\x7E]/g, c => (c === '—' || c === '–' ? '-' : c))

  const lines = [
    `Referentie: ${expense.ref}`,
    `Leverancier: ${supplier}`,
    expense.invoice_number ? `Factuurnummer: ${expense.invoice_number}` : null,
    expense.order_number ? `Ordernummer: ${expense.order_number}` : null,
    `Factuurdatum: ${fmtDate(expense.invoice_date)}`,
    `Betaald op: ${fmtDate(expense.paid_at)} (Revolut)`,
    '',
    `Bruto: ${expense.gross_cents != null ? formatCurrency(expense.gross_cents / 100) : '-'}`,
    `BTW: ${expense.vat_cents != null ? formatCurrency(expense.vat_cents / 100) : '-'}${expense.vat_rate_pct != null ? ` (${Number(expense.vat_rate_pct)}%)` : ''}${expense.vat_source ? ` - bron: ${expense.vat_source}` : ''}`,
    `Netto: ${expense.net_cents != null ? formatCurrency(expense.net_cents / 100) : '-'}`,
    '',
    `Bijlage: ${KIND_LABEL[doc.kind] ?? doc.kind}${doc.original_filename ? ` (${doc.original_filename})` : ''}`,
    expense.notes ? `Notitie: ${expense.notes}` : null,
    '',
    'Automatisch doorgestuurd vanuit de Off Course finance inbox.',
  ].filter((l): l is string => l !== null)

  const ext = (doc.original_filename?.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? (doc.mime_type === 'application/pdf' ? '.pdf' : '')).toLowerCase()
  const base = (doc.original_filename ?? 'document').replace(/\.[a-z0-9]{2,5}$/i, '')
  return { to: recipient, subject, body: lines.join('\n'), attachmentFilename: `${expense.ref}_${base}${ext}` }
}

export type ForwardOutcome =
  | { ok: true; messageId: string; recipient: string }
  | { ok: false; reason: ForwardRefusal; detail?: string }

export type ForwardRefusal = 'not_found' | 'already_sent' | 'no_document' | 'not_ready' | 'not_confirmed' | 'vat_conflict' | 'ignored_or_booked' | 'not_configured' | 'download_failed' | 'send_failed'

/** Statuses a human may forward from: the document is accepted (matched) or fully ready. Never a partial match, never a record under review. */
const MANUAL_FORWARD_STATUSES = new Set<string>(['matched', 'ready_for_snelstart'])

export interface ForwardOptions {
  /** 'manual' may also send a `matched` record (Beer decided the VAT is fine without a second source); 'cron' only sends ready_for_snelstart. */
  actor: 'cron' | 'manual'
}

export async function forwardExpenseToSnelstart(supabase: Admin, expenseId: string, opts: ForwardOptions): Promise<ForwardOutcome> {
  const { data: expense, error } = await supabase.from('finance_expenses').select('*').eq('id', expenseId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!expense) return { ok: false, reason: 'not_found' }
  if (expense.snelstart_sent_at) return { ok: false, reason: 'already_sent' }
  if (expense.status === 'ignored' || expense.status === 'booked') return { ok: false, reason: 'ignored_or_booked' }
  if (expense.vat_conflict != null) return { ok: false, reason: 'vat_conflict' }
  if (opts.actor === 'cron' && !(AUTO_FORWARD_STATUSES as readonly string[]).includes(expense.status)) return { ok: false, reason: 'not_ready' }
  if (opts.actor === 'manual' && !MANUAL_FORWARD_STATUSES.has(expense.status)) return { ok: false, reason: 'not_confirmed' }
  if (!expense.primary_document_id) return { ok: false, reason: 'no_document' }
  const recipient = snelstartRecipient()
  if (!recipient) return { ok: false, reason: 'not_configured', detail: 'SNELSTART_INBOX_EMAIL ontbreekt' }

  const { data: doc, error: docErr } = await supabase.from('finance_documents').select('*').eq('id', expense.primary_document_id).maybeSingle()
  if (docErr) throw new Error(docErr.message)
  if (!doc?.file_path) return { ok: false, reason: 'no_document', detail: 'Het primaire document heeft geen bestand (alleen een mail of een niet-opgehaalde link).' }

  // Claim before sending. The `.is(null)` makes two racing senders resolve to one winner.
  const claimedAt = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from('finance_expenses')
    .update({ snelstart_sent_at: claimedAt })
    .eq('id', expenseId)
    .is('snelstart_sent_at', null)
    .select('id')
  if (claimErr) throw new Error(claimErr.message)
  if (!claimed || claimed.length === 0) return { ok: false, reason: 'already_sent' }

  const release = async () => {
    await supabase.from('finance_expenses').update({ snelstart_sent_at: null }).eq('id', expenseId).eq('snelstart_sent_at', claimedAt)
  }

  const bytes = await downloadFinanceAttachment(supabase, doc.file_path)
  if (!bytes) {
    await release()
    return { ok: false, reason: 'download_failed', detail: doc.file_path }
  }

  const mail = buildForwardEmail(expense, doc, recipient)
  let sent: { id: string }
  try {
    sent = await sendNewEmail({
      to: mail.to,
      subject: mail.subject,
      body: mail.body,
      attachments: [{ filename: mail.attachmentFilename, mimeType: doc.mime_type ?? 'application/octet-stream', content: bytes }],
    })
  } catch (err) {
    await release()
    return { ok: false, reason: 'send_failed', detail: err instanceof Error ? err.message : String(err) }
  }

  // The mail is out. Whatever happens below is bookkeeping on our side and must never read as "not sent".
  try {
    const { error: upErr } = await supabase
      .from('finance_expenses')
      .update({ snelstart_document_id: doc.id, snelstart_recipient: mail.to, snelstart_message_id: sent.id, updated_at: new Date().toISOString() })
      .eq('id', expenseId)
    if (upErr) console.error('[finance/expenses/forward] sent but could not record details:', upErr.message)
    await recomputeExpense(supabase, expenseId)
  } catch (err) {
    console.error('[finance/expenses/forward] sent but post-send bookkeeping failed:', err instanceof Error ? err.message : err)
  }
  return { ok: true, messageId: sent.id, recipient: mail.to }
}

/**
 * A run killed between claim and send (timeout, OOM) leaves `snelstart_sent_at`
 * set with no message id — the batch would skip it forever and the UI would
 * say "sent". Release such claims after STALE_CLAIM_MINUTES and tell Beer.
 */
export async function releaseStaleClaims(supabase: Admin, now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000).toISOString()
  const { data, error } = await supabase
    .from('finance_expenses')
    .update({ snelstart_sent_at: null })
    .lt('snelstart_sent_at', cutoff)
    .is('snelstart_message_id', null)
    .is('booked_at', null)
    .select('id, ref')
  if (error) throw new Error(error.message)
  const released = (data ?? []).map(r => r.ref)
  for (const r of data ?? []) await recomputeExpense(supabase, r.id)
  return released
}

export interface ForwardBatchResult {
  enabled: boolean
  considered: number
  sent: number
  /** Claims from a crashed earlier run that were released for retry. */
  released: string[]
  failed: Array<{ id: string; ref: string; reason: string; detail?: string }>
}

/** The hourly pass: everything ready, oldest match first, one document per record, written once. */
export async function forwardReadyExpenses(supabase: Admin, opts: { limit?: number } = {}): Promise<ForwardBatchResult> {
  const { data: settings } = await supabase.from('finance_settings').select('snelstart_auto_forward').eq('id', 'default').maybeSingle()
  if (settings && settings.snelstart_auto_forward === false) return { enabled: false, considered: 0, sent: 0, released: [], failed: [] }
  if (!snelstartRecipient()) {
    console.error('[finance/expenses/forward] SNELSTART_INBOX_EMAIL is not set — auto-forward skipped')
    return { enabled: false, considered: 0, sent: 0, released: [], failed: [] }
  }

  const released = await releaseStaleClaims(supabase)

  const { data: ready, error } = await supabase
    .from('finance_expenses')
    .select('id, ref')
    .in('status', AUTO_FORWARD_STATUSES)
    .is('snelstart_sent_at', null)
    .not('primary_document_id', 'is', null)
    .order('matched_at', { ascending: true, nullsFirst: false })
    .limit(opts.limit ?? FORWARD_BATCH_LIMIT)
  if (error) throw new Error(error.message)

  const result: ForwardBatchResult = { enabled: true, considered: ready?.length ?? 0, sent: 0, released, failed: [] }
  for (const row of ready ?? []) {
    try {
      const outcome = await forwardExpenseToSnelstart(supabase, row.id, { actor: 'cron' })
      if (outcome.ok) result.sent++
      else if (outcome.reason !== 'already_sent' && outcome.reason !== 'not_ready') result.failed.push({ id: row.id, ref: row.ref, reason: outcome.reason, detail: outcome.detail })
    } catch (err) {
      result.failed.push({ id: row.id, ref: row.ref, reason: 'error', detail: err instanceof Error ? err.message : String(err) })
    }
  }

  if (result.failed.length > 0 || released.length > 0) {
    const lines = [
      ...(released.length > 0 ? [`• ${released.length} vastgelopen claim${released.length === 1 ? '' : 's'} vrijgegeven (${released.join(', ')}) — wordt opnieuw geprobeerd`] : []),
      ...result.failed.slice(0, 10).map(f => `• ${f.ref}: ${f.reason}${f.detail ? ` (${f.detail.slice(0, 120)})` : ''}`),
    ]
    await postSlackOps(`📨 SnelStart doorsturen: ${result.failed.length} mislukt, ${result.sent} verstuurd\n${lines.join('\n')}`).catch(() => undefined)
  }
  return result
}

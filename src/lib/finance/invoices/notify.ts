/**
 * Plan §10: "Slack DM when an invoice needs review" — the nudge that tells Beer
 * a PDF landed at the finance alias (or was uploaded) and what state it's in.
 * Without it an invoice sits in the Facturen inbox until someone happens to
 * open it; the skipper meanwhile thinks they've been paid.
 *
 * postSlackOps, never postSlackText: per CLAUDE.md's routing policy this is
 * an ops nudge to Beer's DM, not a booking/catering notification for the
 * shared channel. Best-effort — never throws into the Gmail poll or the
 * upload route (postSlackOps already swallows its own errors).
 */
import { postSlackOps } from '@/lib/slack/send-notification'
import type { InvoiceCheck } from './match'

export interface InvoiceArrivedNotification {
  /** The Facturen-inbox thread to deep-link into. */
  conversationId: string
  supplierName: string | null
  /** The sender's own filename (finance_invoices.original_filename), for recognisability only. */
  filename: string
  /** Pipeline outcome for this PDF — 'failed' = extraction/matching itself threw. */
  status: 'ready' | 'needs_review' | 'failed'
  amountCents: number | null
  checks: InvoiceCheck[]
}

/** Deep link into the separate Facturen inbox (not the operations inbox). */
export function financeInboxUrl(conversationId: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
  return `${base}/en/admin/finance/inbox?c=${conversationId}`
}

const CHECK_LABEL: Record<string, string> = {
  skipper: 'schipper',
  booking: 'boeking',
  date: 'datum',
  hours: 'uren',
  rate: 'tarief',
  amount: 'bedrag',
  duplicate: 'dubbel',
  iban: 'IBAN',
}

function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace('.', ',')}`
}

export function buildInvoiceArrivedText(n: InvoiceArrivedNotification): string {
  const headline =
    n.status === 'ready' ? 'Factuur binnen — klaar om te betalen'
    : n.status === 'needs_review' ? 'Factuur binnen — controleren'
    : 'Factuur binnen — automatisch verwerken mislukt'
  const who = n.supplierName ?? 'onbekende afzender'
  const parts = [who, n.amountCents != null ? eur(n.amountCents) : null, n.filename].filter((p): p is string => !!p)

  const lines = [`🧾 *${headline}* — ${parts.join(' · ')}`]
  const failed = n.checks.filter(c => !c.ok).map(c => CHECK_LABEL[c.key] ?? c.key)
  if (failed.length) lines.push(`❌ ${failed.join(', ')}`)
  lines.push('', `<${financeInboxUrl(n.conversationId)}|Open in Facturen →>`)
  return lines.join('\n')
}

export async function notifyInvoiceArrived(n: InvoiceArrivedNotification): Promise<void> {
  try {
    await postSlackOps(buildInvoiceArrivedText(n))
  } catch (err) {
    console.error('[finance/invoices/notify] failed:', err instanceof Error ? err.message : err)
  }
}

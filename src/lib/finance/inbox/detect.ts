/**
 * Recognizes a message addressed to the Finance Inbox alias (GMAIL_FINANCE_ADDRESS,
 * e.g. facturen@offcourseamsterdam.com) and decides whether to trust it.
 *
 * Why this exists: this is the one alias on the shared mailbox where an
 * incoming attachment gets fetched and fed to an AI extractor whose output
 * can end up as a Revolut payment draft (see the plan's §6/§6a pipeline).
 * That is real money, so — unlike the general inbox, which trusts any sender
 * — a message here is only ever auto-classified as a known invoice when the
 * sender is someone we already know: a staff member (by email) or a
 * recognised supplier. Anyone else is flagged, never silently trusted,
 * mirroring §17's "the AI should never silently invent missing information"
 * rule one step earlier, at the inbox gate rather than the extraction step.
 *
 * Pure: no I/O. The caller supplies the already-loaded staff/supplier lists.
 */

export type FinanceSenderKind = 'staff' | 'supplier' | 'unknown'

export interface FinanceInvoiceDetection {
  category: 'finance'
  senderKind: FinanceSenderKind
  /** Set when senderKind is 'staff' or 'supplier' — who this is, for auto-matching later. */
  staffId: string | null
  supplierId: string | null
  /** False for an unknown sender: the thread still gets the finance category (so it's visible in
   *  the Finance Inbox filter and attachments still get fetched — Beer needs to SEE the mail to
   *  judge it), but the review card must not pre-fill anything from it. */
  trusted: boolean
}

export interface DetectFinanceInvoiceInput {
  toAddresses: string[]
  fromEmail: string
  financeAddress: string | null | undefined
  knownStaff: Array<{ id: string; email: string | null }>
  knownSuppliers: Array<{ id: string; email: string | null }>
}

function norm(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Returns a detection only when the message is actually addressed to the
 * finance alias. Returns null (not a "finance" result) for every other
 * message, including when GMAIL_FINANCE_ADDRESS is unset — the caller then
 * falls through to the normal inbox path untouched.
 */
export function detectFinanceInvoice(input: DetectFinanceInvoiceInput): FinanceInvoiceDetection | null {
  const financeAddress = input.financeAddress ? norm(input.financeAddress) : null
  if (!financeAddress) return null
  const addressedToFinance = input.toAddresses.some(a => norm(a) === financeAddress)
  if (!addressedToFinance) return null

  const from = norm(input.fromEmail)
  const staff = input.knownStaff.find(s => s.email && norm(s.email) === from)
  if (staff) {
    return { category: 'finance', senderKind: 'staff', staffId: staff.id, supplierId: null, trusted: true }
  }
  const supplier = input.knownSuppliers.find(s => s.email && norm(s.email) === from)
  if (supplier) {
    return { category: 'finance', senderKind: 'supplier', staffId: null, supplierId: supplier.id, trusted: true }
  }
  return { category: 'finance', senderKind: 'unknown', staffId: null, supplierId: null, trusted: false }
}

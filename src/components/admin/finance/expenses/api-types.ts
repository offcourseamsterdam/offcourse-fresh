import type { Database } from '@/lib/supabase/types'
import type { ExpenseStatus } from '@/lib/finance/expenses/status'
import type { ExpenseSummary } from '@/lib/finance/expenses/summary'

export const EXPENSES_API = '/api/admin/finance/expenses'

export type ExpenseApiRow = Database['public']['Tables']['finance_expenses']['Row']
export type ExpenseDocumentApiRow = Database['public']['Tables']['finance_documents']['Row']

export interface ExpensesResponse {
  expenses: ExpenseApiRow[]
  nextBefore: string | null
}

export interface ExpenseDetailResponse {
  expense: ExpenseApiRow
  documents: ExpenseDocumentApiRow[]
  derivedStatus: ExpenseStatus
  /** False = an e-mailed document from an unknown sender that nothing independent confirms; "Koppeling bevestigen" makes it trusted. */
  provenanceTrusted: boolean
}

export interface OrphanDocumentsResponse {
  documents: ExpenseDocumentApiRow[]
}

export type ExpenseSummaryResponse = ExpenseSummary

export type ExpenseActionBody =
  | { action: 'link'; documentId: string }
  | { action: 'unlink'; documentId: string }
  | { action: 'confirm' }
  | { action: 'ignore'; note?: string | null }
  | { action: 'unignore' }
  | { action: 'clear_review' }
  | { action: 'vat'; vatCents: number; ratePct?: number | null }
  | { action: 'booked' }
  | { action: 'forward' }

export const DOCUMENT_KIND_LABELS: Record<ExpenseDocumentApiRow['kind'], string> = {
  invoice_pdf: 'Factuur (PDF)',
  receipt_image: 'Bon (foto)',
  revolut_receipt: 'Bon (Revolut)',
  order_confirmation_email: 'Orderbevestiging',
  invoice_notification_email: 'Factuurmelding',
  payment_confirmation_email: 'Betalingsbevestiging',
  other_email: 'E-mail',
  invoice_link: 'Factuurlink',
}

export { VAT_SOURCE_LABELS } from '@/lib/finance/expenses/vat'

import { z } from 'zod'
import { EXPENSE_STATUSES } from './status'

export { EXPENSE_STATUSES }

/** An empty query value (`?status=`) means "not given", like the transactions route. */
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v)

export const expenseListQuerySchema = z.object({
  status: z.preprocess(blankToUndefined, z.enum([...EXPENSE_STATUSES, 'open']).optional()),
  q: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
  before: z.preprocess(blankToUndefined, z.string().datetime({ offset: true }).optional()),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).optional()),
})

/** One POST body for every UI action; the `action` field picks the branch. */
export const expenseActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), documentId: z.string().uuid() }),
  z.object({ action: z.literal('unlink'), documentId: z.string().uuid() }),
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('ignore'), note: z.string().trim().max(500).nullable().optional() }),
  z.object({ action: z.literal('unignore') }),
  z.object({ action: z.literal('clear_review') }),
  z.object({ action: z.literal('vat'), vatCents: z.number().int().min(0), ratePct: z.number().min(0).max(100).nullable().optional() }),
  z.object({ action: z.literal('booked') }),
  z.object({ action: z.literal('forward') }),
  z.object({ action: z.literal('link_supplier'), supplierId: z.string().uuid() }),
  z.object({ action: z.literal('create_supplier'), name: z.string().trim().min(1).max(200), iban: z.string().trim().min(1).max(34) }),
  z.object({ action: z.literal('draft_payment') }),
])
export type ExpenseAction = z.infer<typeof expenseActionSchema>

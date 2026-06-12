import { z } from 'zod'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

const timestamp = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Invalid timestamp')

export const SHIFT_STATUSES = ['open', 'assigned', 'confirmed', 'completed', 'cancelled'] as const
export type ShiftStatus = (typeof SHIFT_STATUSES)[number]

/** POST /api/admin/scheduling/sync */
export const syncBodySchema = z.object({
  from: dateStr,
  to: dateStr,
})

/** POST /api/admin/scheduling/shifts — manual shift (maintenance, charter hold, expected-demand pre-add) */
export const manualShiftSchema = z.object({
  date: dateStr,
  start_at: timestamp,
  end_at: timestamp,
  boat_id: z.uuid(),
  staff_id: z.uuid().nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
})

/** PUT /api/admin/scheduling/shifts/[id] — assign / edit */
export const updateShiftSchema = z.object({
  staff_id: z.uuid().nullable().optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
  boat_id: z.uuid().optional(),
  date: dateStr.optional(),
  start_at: timestamp.optional(),
  end_at: timestamp.optional(),
  notes: z.string().trim().min(1).nullable().optional(),
})

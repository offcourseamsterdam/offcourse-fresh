import { z } from 'zod'

/**
 * Body validation for /api/admin/scheduling/staff (POST) and /[id] (PUT).
 * One schema for both: create and update send the same full payload
 * (the form modal always submits every field).
 */
export const staffBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().min(1).nullable().optional(),
  email: z.email('Invalid email').nullable().optional(),
  role: z.enum(['skipper', 'host']),
  hourly_rate_cents: z.number().int().min(0),
  slack_member_id: z.string().trim().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
  max_shifts_per_week: z.number().int().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
  /** Linked login — a user_profiles id with role 'captain', or null. */
  user_id: z.uuid().nullable().optional(),
})

export type StaffBody = z.infer<typeof staffBodySchema>

/**
 * Parsed body → the row shape both POST (insert) and PUT (update) write.
 * Optional-and-absent fields become explicit nulls/defaults: the form modal
 * always submits every field, so absence means "cleared", not "unchanged".
 */
export function staffBodyToRow(body: StaffBody) {
  return {
    name: body.name,
    phone: body.phone ?? null,
    email: body.email ?? null,
    role: body.role,
    hourly_rate_cents: body.hourly_rate_cents,
    slack_member_id: body.slack_member_id ?? null,
    is_active: body.is_active ?? true,
    max_shifts_per_week: body.max_shifts_per_week ?? null,
    notes: body.notes ?? null,
    user_id: body.user_id ?? null,
  }
}

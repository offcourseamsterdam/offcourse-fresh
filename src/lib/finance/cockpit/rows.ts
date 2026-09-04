/** Database row → engine row mappers shared by the cockpit API routes. */

import type { Database } from '@/lib/supabase/types'
import type { GoalRow } from './types'

type GoalDbRow = Database['public']['Tables']['finance_goals']['Row']

export function toGoalRow(r: GoalDbRow): GoalRow {
  return {
    id: r.id,
    name: r.name,
    targetCents: r.target_cents,
    fundedCents: r.funded_cents,
    deadline: r.deadline,
    priority: r.priority,
    monthlyFundingCents: r.monthly_funding_cents,
    status: r.status as GoalRow['status'],
    createdAt: r.created_at.slice(0, 10),
    boatId: r.boat_id,
  }
}

import type { AvailabilitySlot } from '@/types'

export type Dagdeel = 'all' | 'morning' | 'afternoon' | 'evening'

const RANGES: Record<Exclude<Dagdeel, 'all'>, [string, string]> = {
  morning:   ['06:00', '12:00'],
  afternoon: ['12:00', '17:00'],
  evening:   ['17:00', '23:00'],
}

export function filterSlotsByDagdeel(
  slots: AvailabilitySlot[],
  dagdeel: Dagdeel,
): AvailabilitySlot[] {
  if (dagdeel === 'all') return slots
  const [from, to] = RANGES[dagdeel]
  return slots.filter(s => s.startTime >= from && s.startTime < to)
}

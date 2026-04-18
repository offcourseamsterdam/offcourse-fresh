import type { AvailabilitySlot } from '@/types'

export function isBoatBookableInSlot(slot: AvailabilitySlot, boatId: string): boolean {
  return slot.customerTypes.some(ct => ct.boatId === boatId && ct.totalCapacity >= 1)
}

export function findNearestSlotsForBoat(
  allSlots: AvailabilitySlot[],
  selectedSlot: AvailabilitySlot,
  boatId: string,
): { earlier: AvailabilitySlot | null; later: AvailabilitySlot | null } {
  const sorted = [...allSlots].sort((a, b) => a.startAt.localeCompare(b.startAt))
  const selectedTime = selectedSlot.startAt
  let earlier: AvailabilitySlot | null = null
  let later: AvailabilitySlot | null = null

  for (const s of sorted) {
    if (s.pk === selectedSlot.pk) continue
    if (!isBoatBookableInSlot(s, boatId)) continue
    if (s.startAt < selectedTime) {
      earlier = s
    } else if (s.startAt > selectedTime && !later) {
      later = s
    }
  }

  return { earlier, later }
}

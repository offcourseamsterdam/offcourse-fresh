export type BoatGuess = 'Diana' | 'Curaçao' | null

export interface SharedCapacityResult {
  spotsLeft: number
  boatGuess: BoatGuess
}

const BOAT_MAX_GUESTS: Record<'Diana' | 'Curaçao', number> = {
  Diana: 8,
  Curaçao: 12,
}

/**
 * Guesses which boat a shared cruise slot is running on, from its full
 * (pre-booking) seat count. FareHarbor's API never returns a resource/boat
 * field for shared availabilities — verified exhaustively against our own
 * account (booking, item, and availability payloads all lack it, even
 * against the official schema) — but the capacity number itself IS derived
 * from whichever boat is assigned. An exact match against a boat's known
 * max guest count is a reasonable signal, so this returns null instead of
 * guessing when the number doesn't cleanly match either boat (e.g. a
 * listing configured with its own lower seat cap, unrelated to which
 * physical boat runs it).
 */
export function guessBoatFromCapacity(fullCapacity: number): BoatGuess {
  if (fullCapacity === BOAT_MAX_GUESTS.Diana) return 'Diana'
  if (fullCapacity === BOAT_MAX_GUESTS.Curaçao) return 'Curaçao'
  return null
}

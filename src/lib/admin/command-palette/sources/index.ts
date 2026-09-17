import { bookingsSource } from './bookings'
import { chatsSource } from './chats'
import { partnersSource, promoCodesSource } from './partners'
import { cruiseListingsSource } from './cruise-listings'
import { FINANCE_SOURCES } from './finance'
import type { SearchSource } from './types'

/** One entry per searchable thing. Add a new entity by adding one entry here — see docs/features/command-palette.md. */
export const ALL_SOURCES: SearchSource[] = [
  bookingsSource,
  chatsSource,
  partnersSource,
  promoCodesSource,
  cruiseListingsSource,
  ...FINANCE_SOURCES,
]

export type { SearchSource } from './types'

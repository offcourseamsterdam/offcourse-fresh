import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { PaletteItem, PaletteScope } from '../types'

export type AdminSupabase = SupabaseClient<Database>

export interface SearchSource {
  /** Result group header — "Bookings", "Chats", "Finance", "Partners & promo", "Cruises". */
  group: string
  /** Which `b`/`c`/`f`/`p` prefix scope this source responds to, if any (see parse-query.ts). */
  scope?: PaletteScope
  /** Runs one search against this source. Never throws — a query error returns []; see run-search.ts for the timeout/failure handling around this. */
  search(supabase: AdminSupabase, query: string): Promise<PaletteItem[]>
}

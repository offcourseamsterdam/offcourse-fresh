import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/v1/status
// Public health check for the /api/v1 public API — the `status` link
// relation in /.well-known/api-catalog (RFC 9727). Verifies the database
// dependency is actually reachable rather than just returning a static 200.
export async function GET() {
  const supabase = createAdminClient()
  const { error } = await supabase.from('cruise_listings').select('id').limit(1)

  if (error) {
    return NextResponse.json({ status: 'error' }, { status: 503 })
  }

  return NextResponse.json({ status: 'ok' })
}

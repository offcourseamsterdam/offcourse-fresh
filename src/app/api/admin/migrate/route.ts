import { apiOk, apiError } from '@/lib/api/response'

const PROJECT_REF = 'fkylzllxvepmrtqxisrn'

/**
 * POST /api/admin/migrate
 *
 * Runs a SQL statement against the Supabase database using the Management API.
 * Requires SUPABASE_MANAGEMENT_TOKEN in .env.local.
 *
 * Body: { sql: string }
 *
 * How to get a management token:
 *   supabase.com → Account → Access Tokens → Generate new token
 *   Add to .env.local as: SUPABASE_MANAGEMENT_TOKEN=sbp_...
 */
export async function POST(request: Request) {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN
  if (!token) {
    return apiError('SUPABASE_MANAGEMENT_TOKEN not set in .env.local')
  }

  const body = await request.json()
  const { sql } = body
  if (!sql) {
    return apiError('sql required in body', 400)
  }

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })

  const json = await res.json()

  if (!res.ok) {
    return apiError(json.message ?? JSON.stringify(json))
  }

  return apiOk({ result: json })
}

/**
 * GET /api/admin/migrate?migration=010_bookings
 *
 * Runs a named migration file from supabase/migrations/.
 * Lists available migrations if no name given.
 */
export async function GET(request: Request) {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN
  const { searchParams } = new URL(request.url)
  const migration = searchParams.get('migration')

  if (!token) {
    return apiError('SUPABASE_MANAGEMENT_TOKEN not set')
  }

  if (!migration) {
    return apiError('migration param required', 400)
  }

  // Read migration file
  const fs = await import('fs/promises')
  const path = await import('path')
  const filePath = path.join(process.cwd(), 'supabase', 'migrations', `${migration}.sql`)

  let sql: string
  try {
    sql = await fs.readFile(filePath, 'utf-8')
  } catch {
    return apiError(`Migration file not found: supabase/migrations/${migration}.sql`, 404)
  }

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })

  const json = await res.json()

  if (!res.ok) {
    return apiError(json.message ?? JSON.stringify(json))
  }

  return apiOk({ migration, result: json })
}

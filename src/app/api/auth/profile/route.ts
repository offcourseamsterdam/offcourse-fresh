import { apiOk } from '@/lib/api/response'
import { getUserProfile } from '@/lib/auth/server'

export async function GET() {
  const profile = await getUserProfile()

  if (!profile) {
    return apiOk({ profile: null })
  }

  return apiOk({ profile })
}

import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getRevolutPublicCert, getRevolutPrivateKey } from '@/lib/revolut/auth'
import { revolut } from '@/lib/revolut/client'

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const redirectUri = `${protocol}://${host}/api/admin/revolut/callback`

  const publicCert = getRevolutPublicCert()
  const hasPrivateKey = Boolean(getRevolutPrivateKey())
  const clientId = process.env.REVOLUT_CLIENT_ID || null
  const isConfigured = revolut.isConfigured()

  const authorizeUrl = clientId
    ? `https://business.revolut.com/app-confirm?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`
    : null

  return apiOk({
    isConfigured,
    hasCertificate: Boolean(publicCert && hasPrivateKey),
    publicCert,
    clientId,
    redirectUri,
    authorizeUrl,
  })
}

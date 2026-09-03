import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseVatInput } from '@/lib/companies/vat'

interface ViesResponse {
  isValid: boolean
  requestDate: string
  userError: string
  name: string
  address: string
  viesApproximate?: {
    name: string
    street: string
    postalCode: string
    city: string
    companyType: string
    matchName: number
    matchStreet: number
    matchPostalCode: number
    matchCity: number
    matchCompanyType: number
  }
}

/**
 * POST /api/admin/companies/validate-vat
 * Body: { vatNumber: string }
 *
 * Validates an EU VAT number using the European Commission VIES REST API.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = await request.json()
    const rawVat = String(body.vatNumber ?? '').trim()
    if (!rawVat) {
      return apiError('Missing required field: vatNumber', 400)
    }

    const parsed = parseVatInput(rawVat)
    if (!parsed) {
      return apiError('Invalid EU VAT format. Example: NL867981374B01', 422)
    }

    const { countryCode, vatNumber } = parsed
    const viesUrl = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`

    try {
      const response = await fetch(viesUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000),
      })

      if (!response.ok) {
        // VIES API service unavailable / rate limit
        return apiOk({
          isValid: false,
          countryCode,
          vatNumber: `${countryCode}${vatNumber}`,
          companyName: null,
          address: null,
          error: `VIES service responded with status ${response.status}`,
        })
      }

      const data = await response.json() as ViesResponse
      const formattedAddress = (data.address || '').replace(/[\r\n]+/g, ', ').trim()

      return apiOk({
        isValid: Boolean(data.isValid),
        countryCode,
        vatNumber: `${countryCode}${vatNumber}`,
        companyName: data.name || null,
        address: formattedAddress || null,
      })
    } catch (fetchErr) {
      const isTimeout = fetchErr instanceof Error && (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError')
      return apiOk({
        isValid: false,
        countryCode,
        vatNumber: `${countryCode}${vatNumber}`,
        companyName: null,
        address: null,
        error: isTimeout ? 'VIES validation timed out' : 'Could not contact VIES service',
      })
    }
  } catch (err) {
    console.error('[validate-vat] Error:', err)
    return apiError(err instanceof Error ? err.message : 'Internal error', 500)
  }
}

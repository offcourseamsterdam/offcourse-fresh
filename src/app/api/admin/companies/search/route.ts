import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseVatInput } from '@/lib/companies/vat'

export interface CompanySearchResult {
  id?: string
  companyName: string
  kvkNumber?: string | null
  vatNumber?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  addressLine1?: string | null
  postalCode?: string | null
  city?: string | null
  countryCode?: string | null
  source: 'database' | 'kvk' | 'vies' | 'partner'
}

/**
 * GET /api/admin/companies/search?q=...
 *
 * Searches for business profiles across:
 * 1. Local `business_profiles` directory
 * 2. `partners` directory
 * 3. EU VIES (if query matches VAT format)
 * 4. KVK Zoeken API (if KVK_API_KEY is configured and query is 8 digits or company name)
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const url = new URL(request.url)
    const rawQ = url.searchParams.get('q')?.trim() ?? ''
    const q = rawQ.replace(/[,().:*"\\]/g, ' ').replace(/\s+/g, ' ').trim()
    if (q.length < 2) {
      return apiOk({ results: [] })
    }

    const supabase = createAdminClient()
    const results: CompanySearchResult[] = []
    const seenNames = new Set<string>()

    const isEightDigitKvk = /^\d{8}$/.test(q)
    const parsedVat = parseVatInput(rawQ)

    // Execute internal DB queries and external APIs concurrently
    const [dbProfilesRes, partnersRes, kvkItems, viesItem] = await Promise.all([
      // 1. Search local business_profiles table
      supabase
        .from('business_profiles')
        .select('id, company_name, kvk_number, vat_number, contact_name, contact_email, contact_phone, address_line1, postal_code, city, country_code')
        .or(`company_name.ilike.%${q}%,kvk_number.ilike.%${q}%,vat_number.ilike.%${q}%,contact_name.ilike.%${q}%`)
        .limit(10),

      // 2. Search partners table
      supabase
        .from('partners')
        .select('id, name, email')
        .ilike('name', `%${q}%`)
        .limit(5),

      // 3. Optional KVK Zoeken API lookup (if KVK_API_KEY configured and not pure VAT lookup)
      (async (): Promise<CompanySearchResult[]> => {
        const kvkApiKey = process.env.KVK_API_KEY
        if (!kvkApiKey || (parsedVat && !isEightDigitKvk) || (!isEightDigitKvk && q.length < 3)) {
          return []
        }
        try {
          const kvkParam = isEightDigitKvk ? `kvkNummer=${q}` : `handelsnaam=${encodeURIComponent(q)}`
          const kvkRes = await fetch(`https://api.kvk.nl/api/v2/zoeken?${kvkParam}&resultatenPerPagina=5`, {
            headers: {
              'apikey': kvkApiKey,
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(3000),
          })

          if (kvkRes.ok) {
            const kvkData = await kvkRes.json() as {
              resultaten?: Array<{
                kvkNummer: string
                naam: string
                adres?: {
                  straatnaam?: string
                  huisnummer?: string
                  postcode?: string
                  plaats?: string
                }
              }>
            }

            if (kvkData.resultaten) {
              return kvkData.resultaten.map(item => {
                const street = [item.adres?.straatnaam, item.adres?.huisnummer].filter(Boolean).join(' ')
                return {
                  companyName: item.naam,
                  kvkNumber: item.kvkNummer,
                  addressLine1: street || null,
                  postalCode: item.adres?.postcode || null,
                  city: item.adres?.plaats || null,
                  countryCode: 'NL',
                  source: 'kvk' as const,
                }
              })
            }
          }
        } catch (kvkErr) {
          console.warn('[companies/search] KVK API lookup failed:', kvkErr)
        }
        return []
      })(),

      // 4. If query matches VAT format, validate with VIES
      (async (): Promise<CompanySearchResult | null> => {
        if (!parsedVat) return null
        try {
          const viesUrl = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${parsedVat.countryCode}/vat/${parsedVat.vatNumber}`
          const viesRes = await fetch(viesUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(3000),
          })
          if (viesRes.ok) {
            const viesData = await viesRes.json() as { isValid?: boolean; name?: string; address?: string }
            if (viesData.isValid && viesData.name) {
              const formattedAddress = (viesData.address || '').replace(/[\r\n]+/g, ', ').trim()
              return {
                companyName: viesData.name,
                vatNumber: `${parsedVat.countryCode}${parsedVat.vatNumber}`,
                addressLine1: formattedAddress || null,
                countryCode: parsedVat.countryCode,
                source: 'vies' as const,
              }
            }
          }
        } catch {
          // Non-blocking
        }
        return null
      })(),
    ])

    // Merge database profiles
    if (dbProfilesRes.error) {
      console.error('[companies/search] DB query error:', dbProfilesRes.error)
    } else if (dbProfilesRes.data) {
      for (const p of dbProfilesRes.data) {
        seenNames.add(p.company_name.toLowerCase())
        results.push({
          id: p.id,
          companyName: p.company_name,
          kvkNumber: p.kvk_number,
          vatNumber: p.vat_number,
          contactName: p.contact_name,
          contactEmail: p.contact_email,
          contactPhone: p.contact_phone,
          addressLine1: p.address_line1,
          postalCode: p.postal_code,
          city: p.city,
          countryCode: p.country_code || 'NL',
          source: 'database',
        })
      }
    }

    // Merge partners
    if (partnersRes.data) {
      for (const partner of partnersRes.data) {
        if (!seenNames.has(partner.name.toLowerCase())) {
          seenNames.add(partner.name.toLowerCase())
          results.push({
            id: partner.id,
            companyName: partner.name,
            contactEmail: partner.email,
            countryCode: 'NL',
            source: 'partner',
          })
        }
      }
    }

    // Merge KVK results
    for (const item of kvkItems) {
      const nameLower = item.companyName.toLowerCase()
      if (!seenNames.has(nameLower)) {
        seenNames.add(nameLower)
        results.push(item)
      }
    }

    // Merge VIES result
    if (viesItem && !seenNames.has(viesItem.companyName.toLowerCase())) {
      const fullVat = viesItem.vatNumber
      if (!results.some(r => r.vatNumber === fullVat)) {
        seenNames.add(viesItem.companyName.toLowerCase())
        results.push(viesItem)
      }
    }

    return apiOk({ results })
  } catch (err) {
    console.error('[companies/search] Error:', err)
    return apiError(err instanceof Error ? err.message : 'Internal error', 500)
  }
}

'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Building2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import type { CompanySearchResult } from '@/app/api/admin/companies/search/route'

export interface BusinessDetails {
  companyName: string
  kvkNumber: string
  vatNumber: string
  contactName: string
  contactEmail: string
  contactPhone: string
  addressLine1: string
  postalCode: string
  city: string
  countryCode: string
  notes?: string
}

interface Props {
  value: BusinessDetails
  onChange: (details: BusinessDetails) => void
  tourDate: string
}

export function BusinessDetailsPanel({ value, onChange, tourDate }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CompanySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  // VAT validation state
  const [validatingVat, setValidatingVat] = useState(false)
  const [vatStatus, setVatStatus] = useState<{ isValid?: boolean; message?: string } | null>(null)

  // Computed due date for preview: 14 days after tour date
  const dueDateStr = (() => {
    if (!tourDate) return ''
    try {
      const tour = new Date(`${tourDate}T12:00:00Z`)
      const due = new Date(tour.getTime() + 14 * 24 * 60 * 60 * 1000)
      return due.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
    } catch {
      return ''
    }
  })()

  // Debounced search with AbortController to prevent race conditions and unmounted updates
  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(`/api/admin/companies/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (json.ok) {
          setSearchResults(json.data.results ?? [])
          setShowDropdown(true)
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error('Company search error:', err)
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false)
        }
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery])

  function selectCompany(c: CompanySearchResult) {
    onChange({
      companyName: c.companyName || value.companyName,
      kvkNumber: c.kvkNumber || value.kvkNumber,
      vatNumber: c.vatNumber || value.vatNumber,
      contactName: c.contactName || value.contactName,
      contactEmail: c.contactEmail || value.contactEmail,
      contactPhone: c.contactPhone || value.contactPhone,
      addressLine1: c.addressLine1 || value.addressLine1,
      postalCode: c.postalCode || value.postalCode,
      city: c.city || value.city,
      countryCode: c.countryCode || value.countryCode || 'NL',
    })
    setShowDropdown(false)
    setSearchQuery('')
    setVatStatus(null)
  }

  async function handleValidateVat() {
    if (!value.vatNumber.trim()) return
    setValidatingVat(true)
    setVatStatus(null)
    try {
      const res = await fetch('/api/admin/companies/validate-vat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vatNumber: value.vatNumber }),
      })
      const json = await res.json()
      if (json.ok) {
        if (json.data.isValid) {
          setVatStatus({ isValid: true, message: `Valid EU VAT — ${json.data.companyName || 'Registered'}` })
          if (json.data.companyName && !value.companyName) {
            onChange({ ...value, companyName: json.data.companyName })
          }
        } else {
          setVatStatus({ isValid: false, message: json.data.error || 'VAT number could not be validated via VIES' })
        }
      } else {
        setVatStatus({ isValid: false, message: json.error || 'Validation failed' })
      }
    } catch {
      setVatStatus({ isValid: false, message: 'Network error during VAT check' })
    } finally {
      setValidatingVat(false)
    }
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-700" />
            <CardTitle className="text-sm font-semibold text-zinc-900">Business Details (Factuur)</CardTitle>
          </div>
          <span className="text-xs bg-emerald-100 text-emerald-800 font-medium px-2.5 py-0.5 rounded-full">
            Stripe Invoicing
          </span>
        </div>
        <CardDescription className="text-xs text-zinc-500">
          Search for an existing business or type the details below. The invoice will be generated and emailed automatically via Stripe.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search bar */}
        <div className="relative">
          <label className="text-xs font-medium text-zinc-700 block mb-1">
            Quick Auto-Fill (Search Company, KVK, or VAT)
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              placeholder="e.g. Acme BV, 97275611, NL867981374B01…"
              className="pl-9 bg-white"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-zinc-400" />
            )}
          </div>

          {/* Search Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white rounded-lg border border-zinc-200 shadow-lg max-h-60 overflow-y-auto">
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.companyName}-${idx}`}
                  type="button"
                  onClick={() => selectCompany(result)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 border-b border-zinc-100 last:border-none transition-colors"
                >
                  <div className="font-semibold text-zinc-900 flex items-center justify-between">
                    <span>{result.companyName}</span>
                    <span className="text-[10px] text-zinc-400 uppercase">{result.source}</span>
                  </div>
                  <div className="text-zinc-500 flex gap-3 mt-0.5">
                    {result.kvkNumber && <span>KVK: {result.kvkNumber}</span>}
                    {result.vatNumber && <span>BTW: {result.vatNumber}</span>}
                    {result.city && <span>{result.city}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Company Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-zinc-700">
              Bedrijfsnaam / Company Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={value.companyName}
              onChange={e => onChange({ ...value, companyName: e.target.value })}
              placeholder="Acme Corporation B.V."
              className="bg-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">KVK Nummer</label>
            <Input
              value={value.kvkNumber}
              onChange={e => onChange({ ...value, kvkNumber: e.target.value })}
              placeholder="12345678"
              className="bg-white font-mono text-xs"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-700">BTW / VAT ID</label>
              {value.vatNumber.trim() && (
                <button
                  type="button"
                  onClick={handleValidateVat}
                  disabled={validatingVat}
                  className="text-[11px] text-emerald-700 hover:underline font-medium flex items-center gap-1"
                >
                  {validatingVat ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check VIES'}
                </button>
              )}
            </div>
            <Input
              value={value.vatNumber}
              onChange={e => {
                onChange({ ...value, vatNumber: e.target.value })
                setVatStatus(null)
              }}
              placeholder="NL867981374B01"
              className="bg-white font-mono text-xs"
            />
            {vatStatus && (
              <p className={`text-[11px] flex items-center gap-1 mt-0.5 ${vatStatus.isValid ? 'text-emerald-600' : 'text-amber-600'}`}>
                {vatStatus.isValid ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
                {vatStatus.message}
              </p>
            )}
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-zinc-700">
              Adres / Billing Address <span className="text-red-500">*</span>
            </label>
            <Input
              value={value.addressLine1}
              onChange={e => onChange({ ...value, addressLine1: e.target.value })}
              placeholder="Keizersgracht 123"
              className="bg-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">
              Postcode <span className="text-red-500">*</span>
            </label>
            <Input
              value={value.postalCode}
              onChange={e => onChange({ ...value, postalCode: e.target.value })}
              placeholder="1015 CJ"
              className="bg-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">
              Plaats / City <span className="text-red-500">*</span>
            </label>
            <Input
              value={value.city}
              onChange={e => onChange({ ...value, city: e.target.value })}
              placeholder="Amsterdam"
              className="bg-white"
            />
          </div>
        </div>

        {/* Due Date & Virtual IBAN Notice */}
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-950 space-y-1">
          <p className="font-semibold flex items-center gap-1.5 text-emerald-900">
            <span>📅</span> Betaaltermijn: 14 dagen na de vaart
          </p>
          <p className="text-emerald-800 leading-relaxed">
            De factuur vervalt op <strong>{dueDateStr || '14 dagen na de tourdatum'}</strong>.
            Stripe voorziet de factuur automatisch van een <strong>uniek Virtual IBAN (SEPA overboeking)</strong> voor automatische reconciliatie, evenals iDEAL en creditcard.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

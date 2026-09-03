'use client'

import { useState, useRef } from 'react'
import { BusinessDetailsPanel, type BusinessDetails } from '@/components/admin/fareharbor/BusinessDetailsPanel'
import { FileText, X, AlertCircle, CheckCircle2, Loader2, Calendar } from 'lucide-react'
import { fmtAdminAmount } from '@/lib/admin/format'

interface SendInvoiceModalProps {
  bookingId: string
  bookingDate: string | null
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  listingTitle?: string | null
  baseAmountCents?: number | null
  extrasAmountCents?: number | null
  cityTaxCents?: number | null
  stripeAmount?: number | null
  initialCompanyName?: string | null
  initialKvk?: string | null
  initialVat?: string | null
  initialAddress?: string | null
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function SendInvoiceModal({
  bookingId,
  bookingDate,
  customerName,
  customerEmail,
  customerPhone,
  listingTitle,
  baseAmountCents,
  extrasAmountCents,
  cityTaxCents,
  stripeAmount,
  initialCompanyName,
  initialKvk,
  initialVat,
  initialAddress,
  isOpen,
  onClose,
  onSuccess,
}: SendInvoiceModalProps) {
  const [businessDetails, setBusinessDetails] = useState<BusinessDetails>({
    companyName: initialCompanyName || '',
    kvkNumber: initialKvk || '',
    vatNumber: initialVat || '',
    contactName: customerName || '',
    contactEmail: customerEmail || '',
    contactPhone: customerPhone || '',
    addressLine1: initialAddress || '',
    postalCode: '',
    city: 'Amsterdam',
    countryCode: 'NL',
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  const [daysAfterTour, setDaysAfterTour] = useState(14)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customListingTitle, setCustomListingTitle] = useState(listingTitle || 'Private Boat Tour Amsterdam')
  const [customBaseAmountEur, setCustomBaseAmountEur] = useState(
    (baseAmountCents ?? 0) > 0 ? ((baseAmountCents ?? 0) / 100).toFixed(2) : '310.00'
  )
  const [successResult, setSuccessResult] = useState<{
    hostedInvoiceUrl: string | null
    dueDate: string
    invoiceNumber: string | null
  } | null>(null)

  if (!isOpen) return null

  // Calculate tour date + daysAfterTour
  const tourYmd = bookingDate || new Date().toISOString().slice(0, 10)
  const tourDateObj = new Date(`${tourYmd}T12:00:00Z`)
  const dueDateObj = new Date(tourDateObj.getTime() + daysAfterTour * 24 * 60 * 60 * 1000)
  const dueDateStr = dueDateObj.toISOString().slice(0, 10)

  const currentBaseCents = Math.round(parseFloat(customBaseAmountEur || '0') * 100)
  const totalCalculated = currentBaseCents + (extrasAmountCents ?? 0) + (cityTaxCents ?? 0)

  async function handleSendInvoice(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!businessDetails.companyName.trim()) {
      setError('Vul een bedrijfsnaam in.')
      return
    }
    if (!businessDetails.contactEmail?.trim()) {
      setError('Vul een factuur e-mailadres in.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/send-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...businessDetails,
          daysAfterTour,
          listingTitle: customListingTitle.trim(),
          baseAmountCents: currentBaseCents,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error || 'Fout bij aanmaken en versturen van factuur')
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      setSuccessResult({
        hostedInvoiceUrl: json.data.hostedInvoiceUrl,
        dueDate: json.data.dueDate,
        invoiceNumber: json.data.invoiceNumber,
      })
      onSuccess()
    } catch {
      setError('Netwerkfout bij communicatie met server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-zinc-50/75">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Stripe Factuur Versturen (Achteraf)</h2>
              <p className="text-xs text-zinc-500">
                {listingTitle || 'Boeking'} · Tourdatum: <span className="font-medium text-zinc-700">{bookingDate || '—'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-lg hover:bg-zinc-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="p-6 overflow-y-auto flex-1 space-y-6">
          {successResult ? (
            <div className="text-center py-6 space-y-4">
              <div className="inline-flex p-3 bg-emerald-100 text-emerald-700 rounded-full">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">Factuur succesvol verstuurd via Stripe!</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  Factuurnummer: <span className="font-mono font-medium text-zinc-800">{successResult.invoiceNumber || '—'}</span> · Vervaldatum:{' '}
                  <span className="font-medium text-zinc-800">{successResult.dueDate}</span>
                </p>
              </div>

              {successResult.hostedInvoiceUrl && (
                <div className="pt-3">
                  <a
                    href={successResult.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl text-sm transition-colors shadow-sm"
                  >
                    Open Stripe Betaallink & PDF ↗
                  </a>
                </div>
              )}

              <div className="pt-4 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 font-medium"
                >
                  Sluiten
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSendInvoice} className="space-y-6">
              {error && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Price summary badge */}
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200/80 flex items-center justify-between text-sm">
                <div>
                  <span className="text-xs text-zinc-500 block">Factuurbedrag</span>
                  <span className="text-lg font-bold text-zinc-900">{fmtAdminAmount(totalCalculated)}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-zinc-500 block">Betalingstermijn (14 dagen na tour)</span>
                  <span className="text-sm font-semibold text-emerald-700 flex items-center gap-1 justify-end">
                    <Calendar className="w-3.5 h-3.5" /> {dueDateStr}
                  </span>
                </div>
              </div>

              {/* Cruise / Line item details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-zinc-50 rounded-xl border border-zinc-200/80">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 block">Factuuromschrijving / Vaartocht</label>
                  <input
                    type="text"
                    required
                    value={customListingTitle}
                    onChange={e => setCustomListingTitle(e.target.value)}
                    placeholder="bijv. Private Boat Tour — Curaçao"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-zinc-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-zinc-400">9% BTW incl. (vermeld bijv. boot Curaçao)</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 block">Basistarief (€ incl. 9% BTW)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1.5 text-xs text-zinc-400">€</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={customBaseAmountEur}
                      onChange={e => setCustomBaseAmountEur(e.target.value)}
                      className="w-full pl-6 pr-3 py-1.5 text-xs bg-white border border-zinc-300 rounded-lg focus:ring-1 focus:ring-emerald-500 font-medium"
                    />
                  </div>
                  <p className="text-[11px] text-zinc-400">Excl. toeristenbelasting</p>
                </div>
              </div>

              {/* Billing Contact Override */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-zinc-50 rounded-xl border border-zinc-200/80">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 block">
                    Factuur verzenden naar e-mailadres <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={businessDetails.contactEmail || ''}
                    onChange={e => setBusinessDetails({ ...businessDetails, contactEmail: e.target.value })}
                    placeholder="bijv. facturen@bedrijf.nl"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-zinc-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-zinc-400">Hier wordt de Stripe factuur met Virtual IBAN naartoe gemaild.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 block">T.a.v. Contactpersoon</label>
                  <input
                    type="text"
                    value={businessDetails.contactName || ''}
                    onChange={e => setBusinessDetails({ ...businessDetails, contactName: e.target.value })}
                    placeholder="bijv. Afdeling Financiën of Naam"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-zinc-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-zinc-400">Wordt vermeld op de factuurkop.</p>
                </div>
              </div>

              {/* Business Details Panel */}
              <BusinessDetailsPanel
                value={businessDetails}
                onChange={setBusinessDetails}
                tourDate={bookingDate || ''}
              />

              {/* Custom payment term override if desired */}
              <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
                <label htmlFor="daysAfterTourInput" className="font-medium text-zinc-700">
                  Dagen na tourdatum tot vervaldatum:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="daysAfterTourInput"
                    type="number"
                    min="1"
                    max="90"
                    value={daysAfterTour}
                    onChange={e => setDaysAfterTour(Math.max(1, parseInt(e.target.value) || 14))}
                    className="w-16 px-2 py-1 text-center font-mono text-xs border border-zinc-300 rounded-lg focus:ring-1 focus:ring-emerald-500"
                  />
                  <span>dagen</span>
                </div>
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 rounded-xl hover:bg-zinc-100 transition-colors"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Factuur genereren…
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      Factuur verzenden via Stripe
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

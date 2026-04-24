'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ArrowLeft, Plus, Ban, Copy, Check, AlertCircle } from 'lucide-react'

interface Partner {
  id: string
  name: string
  email: string | null
  contact_name: string | null
  phone: string | null
  website: string | null
  commission_rate: number
  is_active: boolean
  created_at: string | null
}

interface PartnerCode {
  id: string
  code: string
  issued_at: string
  expires_at: string
  is_active: boolean
  revoked_at: string | null
  notes: string | null
}

type CodeStatus = 'active' | 'expired' | 'revoked' | 'expiring_soon'

function codeStatus(c: PartnerCode, now: Date = new Date()): CodeStatus {
  if (!c.is_active || c.revoked_at) return 'revoked'
  const expires = new Date(c.expires_at).getTime()
  if (expires <= now.getTime()) return 'expired'
  if (expires - now.getTime() < 14 * 86_400_000) return 'expiring_soon'
  return 'active'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [partner, setPartner] = useState<Partner | null>(null)
  const [codes, setCodes] = useState<PartnerCode[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, cRes] = await Promise.all([
        fetch(`/api/admin/partners/${id}`),
        fetch(`/api/admin/partners/${id}/codes`),
      ])
      const pJson = await pRes.json()
      const cJson = await cRes.json()
      if (pJson.ok) setPartner(pJson.data.partner)
      if (cJson.ok) setCodes(cJson.data.codes)
    } catch {
      // silently: will show empty state
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/admin/partners/${id}/codes`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        fetchData()
      } else {
        alert(json.error ?? 'Could not generate a new code')
      }
    } finally {
      setGenerating(false)
    }
  }

  async function revoke(codeId: string, code: string) {
    if (!confirm(`Revoke code "${code}"? Bookings made with it up to now are kept, but the code will stop working immediately.`)) return
    try {
      const res = await fetch(`/api/admin/partners/${id}/codes/${codeId}`, { method: 'PATCH' })
      const json = await res.json()
      if (json.ok) fetchData()
      else alert(json.error ?? 'Could not revoke code')
    } catch {
      alert('Network error — please try again')
    }
  }

  async function copyCode(code: string, codeId: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(codeId)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // copy failed silently
    }
  }

  if (loading) {
    return <div className="p-8 flex items-center gap-2 text-zinc-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading partner…</div>
  }
  if (!partner) {
    return <div className="p-8 text-sm text-zinc-500">Partner not found.</div>
  }

  const activeCodes = codes.filter(c => codeStatus(c) === 'active' || codeStatus(c) === 'expiring_soon')
  const historyCodes = codes.filter(c => codeStatus(c) !== 'active' && codeStatus(c) !== 'expiring_soon')

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <a href="/en/admin/partners" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to partners
      </a>

      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">{partner.name}</h1>
        {partner.email && <p className="text-sm text-zinc-500 mt-0.5">{partner.email}</p>}
      </header>

      {/* Partner codes section */}
      <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h2 className="font-semibold text-zinc-900">Partner codes</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Required at checkout on partner-invoice listings. Codes last 3 months — generate a new one before the current one expires.
            </p>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--color-primary)] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Generate new code
          </button>
        </div>

        {codes.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-zinc-400">
            No codes yet. Generate one to enable partner-invoice bookings.
          </div>
        ) : (
          <>
            {/* Active / expiring soon */}
            {activeCodes.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-100">
                    <th className="text-left px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Code</th>
                    <th className="text-left px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Issued</th>
                    <th className="text-left px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Expires</th>
                    <th className="text-left px-5 py-2 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Status</th>
                    <th className="px-5 py-2 w-28" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {activeCodes.map(c => {
                    const status = codeStatus(c)
                    return (
                      <tr key={c.id} className="hover:bg-zinc-50">
                        <td className="px-5 py-3">
                          <button
                            onClick={() => copyCode(c.code, c.id)}
                            className="inline-flex items-center gap-2 font-mono text-sm text-zinc-900 hover:text-[var(--color-primary)]"
                            title="Click to copy"
                          >
                            {c.code}
                            {copiedId === c.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-zinc-500">{fmtDate(c.issued_at)}</td>
                        <td className="px-5 py-3 text-zinc-500">{fmtDate(c.expires_at)}</td>
                        <td className="px-5 py-3">
                          {status === 'expiring_soon' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-amber-700 bg-amber-100 rounded-full">
                              <AlertCircle className="w-3 h-3" />
                              Expires soon
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-100 rounded-full">Active</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => revoke(c.id, c.code)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Revoke
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* History */}
            {historyCodes.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer select-none px-5 py-3 text-xs font-medium text-zinc-500 hover:bg-zinc-50 border-t border-zinc-100">
                  Show history ({historyCodes.length})
                </summary>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-zinc-100">
                    {historyCodes.map(c => {
                      const status = codeStatus(c)
                      return (
                        <tr key={c.id} className="opacity-60">
                          <td className="px-5 py-3 font-mono text-sm text-zinc-500">{c.code}</td>
                          <td className="px-5 py-3 text-zinc-400">{fmtDate(c.issued_at)}</td>
                          <td className="px-5 py-3 text-zinc-400">{fmtDate(c.expires_at)}</td>
                          <td className="px-5 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-zinc-500 bg-zinc-100 rounded-full capitalize">
                              {status}
                            </span>
                          </td>
                          <td />
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </details>
            )}
          </>
        )}
      </section>

      <p className="text-xs text-zinc-400 mt-4 leading-relaxed">
        <strong>How this works:</strong> these codes gate checkout on <em>partner-invoice</em> listings
        — customers type the code from a physical receipt at the partner desk. Make sure a <a href="/en/admin/campaigns" className="underline hover:text-zinc-700">campaign</a> exists linking
        this partner to a specific listing with the agreed commission % (e.g. 15 % = partner keeps €15 on a €100 ticket, we invoice €85).
      </p>
    </div>
  )
}

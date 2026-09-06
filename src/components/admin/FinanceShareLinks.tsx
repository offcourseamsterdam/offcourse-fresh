'use client'

import { useState } from 'react'
import { Link2, Copy, Check, Trash2, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminDate } from '@/lib/admin/format'

interface ShareLink {
  id: string
  token: string
  label: string | null
  created_at: string
  revoked_at: string | null
}

/**
 * Temporary "share with accountant" links — view-only entry point into the
 * Finance tab, no admin login required. See migration 107 +
 * src/lib/auth/finance-share.ts. Meant to be revoked once the Off Course /
 * Boat Local disentanglement is done.
 */
export function FinanceShareLinks() {
  const [open, setOpen] = useState(false)
  const { data, isLoading, refresh } = useAdminFetch<{ links: ShareLink[] }>(
    open ? '/api/admin/finance/share-links' : null,
  )
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const links = (data?.links ?? []).filter(l => !l.revoked_at)

  function shareUrl(token: string) {
    return `${window.location.origin}/api/finance/shared/redeem?token=${token}`
  }

  async function copyLink(l: ShareLink) {
    await navigator.clipboard.writeText(shareUrl(l.token))
    setCopiedId(l.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function createLink() {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/finance/share-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setLabel('')
      refresh()
    } finally {
      setCreating(false)
    }
  }

  async function revokeLink(id: string) {
    await fetch(`/api/admin/finance/share-links/${id}`, { method: 'DELETE' })
    refresh()
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen(o => !o)}>
        <Link2 className="w-3.5 h-3.5" />
        Deel met boekhouder
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white shadow-lg z-20 p-4 space-y-3">
          <p className="text-xs text-zinc-500">
            Publieke link naar alleen dit Finance-tabblad, geen admin-login nodig.
            Tijdelijk, tot aan de ontvlechting — trek in daarna.
          </p>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Laden…
            </div>
          )}

          {!isLoading && links.length === 0 && (
            <p className="text-sm text-zinc-400 py-2">Nog geen actieve links.</p>
          )}

          {links.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {links.map(l => (
                <div key={l.id} className="flex items-center gap-2 text-sm border border-zinc-100 rounded-md px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-900 truncate">{l.label ?? 'Zonder label'}</div>
                    <div className="text-xs text-zinc-400">Aangemaakt {fmtAdminDate(l.created_at)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyLink(l)}
                    className="p-1.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 shrink-0"
                    title="Kopieer link"
                  >
                    {copiedId === l.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => revokeLink(l.id)}
                    className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                    title="Trek link in"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-zinc-100">
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Label (bijv. boekhouder naam)"
              className="flex-1 min-w-0 text-sm border border-zinc-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <Button size="sm" onClick={createLink} disabled={creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Nieuw
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

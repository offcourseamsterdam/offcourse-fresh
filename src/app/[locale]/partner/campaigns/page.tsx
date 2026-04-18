'use client'

import { useState, useEffect } from 'react'
import { Loader2, Copy, Check, ExternalLink } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'

interface Campaign {
  name: string
  slug: string
  bookings_count: number
  commission_cents: number
}

export default function PartnerCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/partner/campaigns')
        const json = await res.json()
        if (json.ok) {
          setCampaigns(json.data)
        } else {
          setError(json.error ?? 'Failed to load campaigns')
        }
      } catch {
        setError('Network error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function copyUrl(slug: string) {
    const url = `https://offcourseamsterdam.com/t/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug(null), 2000)
    } catch {
      // Clipboard API not available
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 sm:p-8">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="p-6 sm:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">Campaigns</h1>
        <p className="text-sm text-zinc-500 mt-1">Your tracking links and their performance.</p>
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
          <p className="text-sm text-zinc-400">
            No campaigns yet &mdash; contact Off Course to set up your tracking links.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {campaigns.map(c => (
            <div
              key={c.slug}
              className="bg-white rounded-2xl border border-zinc-200 p-6 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              {/* Campaign info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-zinc-900">{c.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded font-mono truncate">
                    /t/{c.slug}
                  </code>
                  <button
                    onClick={() => copyUrl(c.slug)}
                    className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
                    title="Copy campaign URL"
                  >
                    {copiedSlug === c.slug ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-green-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                  <a
                    href={`https://offcourseamsterdam.com/t/${c.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-400 hover:text-zinc-600 transition-colors"
                    title="Open campaign link"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Stats */}
              <div className="flex gap-6 sm:gap-8 text-sm">
                <div>
                  <p className="text-zinc-400 text-xs">Bookings</p>
                  <p className="text-zinc-900 font-semibold">{c.bookings_count}</p>
                </div>
                <div>
                  <p className="text-zinc-400 text-xs">Commission</p>
                  <p className="text-zinc-900 font-semibold">{fmtEuros(c.commission_cents)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

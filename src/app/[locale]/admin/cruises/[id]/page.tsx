'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ArrowLeft, Copy, ExternalLink, Loader2 } from 'lucide-react'
import {
  CruiseDetailsTab,
  CruiseImagesSection,
  CruisePricingTab,
  CruisePaymentTab,
  CruiseBenefitsTab,
  CruiseHighlightsTab,
  CruiseInclusionsTab,
  CruiseFAQsTab,
  CruiseCancellationTab,
  CruiseExtrasTab,
  CruiseSeoTab,
} from '@/components/admin/cruise-editor'
import type { CruiseListing } from '@/components/admin/cruise-editor'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CruiseEditPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const locale = (params.locale as string) ?? 'en'

  const [listing, setListing] = useState<CruiseListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/cruise-listings/${id}`)
    const json = await res.json()
    if (json.ok) setListing(json.data)
    else setNotFound(true)
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function duplicate() {
    setDuplicating(true)
    try {
      const res = await fetch(`/api/admin/cruise-listings/${id}/duplicate`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        router.push(`/${locale}/admin/cruises/${json.data.listing.id}`)
      } else {
        alert(json.error ?? 'Could not duplicate listing')
      }
    } finally {
      setDuplicating(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-zinc-400">
        <Loader2 className="animate-spin w-4 h-4" /> Loading listing…
      </div>
    )
  }

  if (notFound || !listing) {
    return (
      <div className="p-8">
        <p className="text-zinc-500">Listing not found.</p>
        <button
          onClick={() => router.push(`/${locale}/admin/cruises`)}
          className="text-sm text-zinc-400 underline mt-2 inline-block"
        >
          ← Back to listings
        </button>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/${locale}/admin/cruises`)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-zinc-900">{listing.title}</h1>
              <Badge variant={listing.is_published ? 'success' : 'secondary'}>
                {listing.is_published ? 'Published' : 'Draft'}
              </Badge>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 font-mono">/cruises/{listing.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={duplicate}
            disabled={duplicating}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 transition-colors disabled:opacity-50"
            title="Duplicate listing"
          >
            {duplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
            Duplicate
          </button>
          {listing.is_published && (
            <a
              href={`/${locale}/cruises/${listing.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View on site
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="content">
        <TabsList className="w-full justify-start border-b border-zinc-200 bg-transparent rounded-none pb-0 h-auto gap-0">
          {['content', 'images', 'pricing', 'payment', 'benefits', 'extras', 'filters', 'seo'].map(tab => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="capitalize rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 pb-2 text-sm"
            >
              {tab === 'filters' ? (
                <span className="flex items-center gap-1.5">
                  Filters
                  <span className="text-[10px] bg-zinc-100 text-zinc-400 px-1.5 py-0.5 rounded-full leading-none">soon</span>
                </span>
              ) : tab}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="content" className="pt-6">
          <CruiseDetailsTab listing={listing} onSave={setListing} />
        </TabsContent>
        <TabsContent value="images" className="pt-6">
          <CruiseImagesSection listing={listing} onSave={setListing} />
        </TabsContent>
        <TabsContent value="pricing" className="pt-6">
          <CruisePricingTab listing={listing} onSave={setListing} />
        </TabsContent>
        <TabsContent value="payment" className="pt-6">
          <CruisePaymentTab listing={listing} onSave={setListing} />
        </TabsContent>
        <TabsContent value="benefits" className="pt-6">
          <div className="space-y-8">
            <CruiseBenefitsTab listing={listing} onSave={setListing} />
            <CruiseHighlightsTab listing={listing} onSave={setListing} />
            <CruiseInclusionsTab listing={listing} onSave={setListing} />
            <CruiseFAQsTab listing={listing} onSave={setListing} />
            <CruiseCancellationTab listing={listing} onSave={setListing} />
          </div>
        </TabsContent>
        <TabsContent value="extras" className="pt-6">
          <CruiseExtrasTab listingId={listing.id} listingCategory={listing.category ?? 'private'} />
        </TabsContent>
        <TabsContent value="filters" className="pt-6">
          <div className="max-w-xl space-y-3">
            <p className="text-sm font-medium text-zinc-700">Availability filters</p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Fine-grained time, day-of-week, and seasonal availability rules per listing — coming soon.
              These control which FareHarbor time slots are shown to guests after boat and duration filtering.
            </p>
            <div className="border border-dashed border-zinc-200 rounded-lg p-6 text-center text-sm text-zinc-300">
              🚧 In progress
            </div>
          </div>
        </TabsContent>
        <TabsContent value="seo" className="pt-6">
          <CruiseSeoTab listing={listing} onSave={setListing} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

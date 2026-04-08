'use client'

import { useState, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { CruiseTabProps, patchListing } from './shared'

export function CruiseImagesSection({ listing, onSave }: CruiseTabProps) {
  const [images, setImages] = useState<Array<{ url: string; alt_text?: string }>>(
    Array.isArray(listing.images) ? listing.images : []
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('listingId', listing.id)
    const res = await fetch('/api/admin/cruise-listings/images', { method: 'POST', body: fd })
    return res.json() as Promise<{ ok: boolean; url?: string; error?: string }>
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true); setError(null)
    const newImages = [...images]
    for (const file of Array.from(files)) {
      const result = await uploadFile(file)
      if (result.ok && result.url) {
        newImages.push({ url: result.url, alt_text: '' })
      } else {
        setError(result.error ?? 'Upload failed — no changes were saved')
        setUploading(false)
        return // abort: don't save partial results
      }
    }
    setImages(newImages)
    const heroUrl = newImages[0]?.url ?? listing.hero_image_url
    const json = await patchListing(listing.id, { images: newImages, hero_image_url: heroUrl })
    if (json.ok && json.data) onSave(json.data)
    setUploading(false)
  }

  async function setHero(url: string) {
    const json = await patchListing(listing.id, { hero_image_url: url })
    if (json.ok && json.data) onSave(json.data)
  }

  async function removeImage(url: string) {
    const updated = images.filter(i => i.url !== url)
    setImages(updated)
    const heroUrl =
      listing.hero_image_url === url ? (updated[0]?.url ?? null) : listing.hero_image_url
    const json = await patchListing(listing.id, { images: updated, hero_image_url: heroUrl })
    if (json.ok && json.data) onSave(json.data)
  }

  return (
    <div className="space-y-6">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          handleFiles(e.dataTransfer.files)
        }}
        className="border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center cursor-pointer hover:border-zinc-400 transition-colors"
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
            <Loader2 className="animate-spin w-4 h-4" /> Uploading…
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-700">Drop images here or click to browse</p>
            <p className="text-xs text-zinc-400 mt-1">JPEG, PNG, WebP — max 10MB each</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {images.map(img => (
            <div
              key={img.url}
              className="relative group rounded-xl overflow-hidden aspect-video bg-zinc-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                {listing.hero_image_url !== img.url && (
                  <button
                    onClick={() => setHero(img.url)}
                    className="text-xs bg-white text-zinc-900 px-2 py-1 rounded-md font-medium hover:bg-zinc-100"
                  >
                    Set as hero
                  </button>
                )}
                <button
                  onClick={() => removeImage(img.url)}
                  className="text-xs bg-red-500 text-white px-2 py-1 rounded-md font-medium hover:bg-red-600"
                >
                  Remove
                </button>
              </div>
              {listing.hero_image_url === img.url && (
                <div className="absolute top-2 left-2 bg-zinc-900 text-white text-xs px-1.5 py-0.5 rounded">
                  Hero
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

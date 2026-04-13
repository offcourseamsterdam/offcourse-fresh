'use client'

import { useState, useRef, useCallback } from 'react'
import { Loader2, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CruiseTabProps, patchListing } from './shared'

type ImageItem = { url: string; alt_text?: string }

/* ── Sortable image card ──────────────────────────────────────────────────── */

function SortableImageCard({
  img,
  isHero,
  onSetHero,
  onRemove,
}: {
  img: ImageItem
  isHero: boolean
  onSetHero: () => void
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: img.url })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group rounded-xl overflow-hidden aspect-video bg-zinc-100"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />

      {/* Drag handle — always visible top-right */}
      <button
        {...attributes}
        {...listeners}
        className="absolute top-2 right-2 bg-black/50 text-white rounded-md p-1 cursor-grab active:cursor-grabbing hover:bg-black/70 transition-colors"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Hover overlay with actions */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
        {!isHero && (
          <button
            onClick={onSetHero}
            className="text-xs bg-white text-zinc-900 px-2 py-1 rounded-md font-medium hover:bg-zinc-100"
          >
            Set as hero
          </button>
        )}
        <button
          onClick={onRemove}
          className="text-xs bg-red-500 text-white px-2 py-1 rounded-md font-medium hover:bg-red-600"
        >
          Remove
        </button>
      </div>

      {/* Hero badge */}
      {isHero && (
        <div className="absolute top-2 left-2 bg-zinc-900 text-white text-xs px-1.5 py-0.5 rounded">
          Hero
        </div>
      )}
    </div>
  )
}

/* ── Static card used inside DragOverlay (no hooks, just visuals) ─────── */

function ImageOverlayCard({ img }: { img: ImageItem }) {
  return (
    <div className="rounded-xl overflow-hidden aspect-video bg-zinc-100 shadow-2xl ring-2 ring-zinc-900/20">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
    </div>
  )
}

/* ── Main component ───────────────────────────────────────────────────────── */

export function CruiseImagesSection({ listing, onSave }: CruiseTabProps) {
  const [images, setImages] = useState<ImageItem[]>(
    Array.isArray(listing.images) ? listing.images : []
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Require 8px movement before dragging starts — prevents accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

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
        return
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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = images.findIndex(i => i.url === active.id)
      const newIndex = images.findIndex(i => i.url === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(images, oldIndex, newIndex)
      setImages(reordered)

      const json = await patchListing(listing.id, { images: reordered })
      if (json.ok && json.data) onSave(json.data)
    },
    [images, listing.id, onSave]
  )

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
  }, [])

  const activeImage = activeId ? images.find(i => i.url === activeId) : null

  return (
    <div className="space-y-6">
      {/* File upload drop zone */}
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

      {/* Sortable image grid */}
      {images.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={images.map(i => i.url)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {images.map(img => (
                <SortableImageCard
                  key={img.url}
                  img={img}
                  isHero={listing.hero_image_url === img.url}
                  onSetHero={() => setHero(img.url)}
                  onRemove={() => removeImage(img.url)}
                />
              ))}
            </div>
          </SortableContext>

          {/* Floating overlay — this is the key to smooth, shake-free dragging */}
          <DragOverlay adjustScale={false} dropAnimation={null}>
            {activeImage ? <ImageOverlayCard img={activeImage} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

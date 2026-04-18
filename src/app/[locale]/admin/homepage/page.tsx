'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Trash2, GripVertical, Image as ImageIcon, Upload, Loader2 } from 'lucide-react'
import { SafeImage } from '@/components/ui/SafeImage'

// ── Types ────────────────────────────────────────────────────────────────────

type Slide = {
  id: string
  image_url: string
  alt_text: string | null
  caption: string | null
  sort_order: number
  is_active: boolean
  media_type: string | null
}

type PriorityCard = {
  id: string
  image_url: string
  alt_text: string | null
  title: string
  body: string
  rotate: string
  sort_order: number
}

// ── Shared upload helper ─────────────────────────────────────────────────────

async function uploadFile(file: File): Promise<{ url: string; mediaType: string } | null> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/admin/hero/upload', { method: 'POST', body: formData })
  const json = await res.json()
  if (!json.ok) {
    alert('Upload failed: ' + json.error)
    return null
  }
  return { url: json.data.url, mediaType: json.data.mediaType }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomepageAdminPage() {
  const supabase = createClient()

  // ── Hero Carousel state ──────────────────────────────────────────────────
  const [slides, setSlides] = useState<Slide[]>([])
  const [loadingSlides, setLoadingSlides] = useState(true)
  const [savingSlide, setSavingSlide] = useState<string | null>(null)
  const [uploadingSlide, setUploadingSlide] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newSlide, setNewSlide] = useState({ image_url: '', alt_text: '', caption: '', media_type: 'image' })
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const rowFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // ── Priorities state ─────────────────────────────────────────────────────
  const [priorityCards, setPriorityCards] = useState<PriorityCard[]>([])
  const [loadingPriorities, setLoadingPriorities] = useState(true)
  const [savingPriority, setSavingPriority] = useState<string | null>(null)
  const [uploadingPriority, setUploadingPriority] = useState<string | null>(null)
  const priorityFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    loadSlides()
    loadPriorityCards()
  }, [])

  async function loadSlides() {
    setLoadingSlides(true)
    const { data } = await supabase
      .from('hero_carousel_items')
      .select('*')
      .order('sort_order')
    setSlides((data ?? []) as Slide[])
    setLoadingSlides(false)
  }

  async function loadPriorityCards() {
    setLoadingPriorities(true)
    const { data } = await supabase
      .from('priorities_cards')
      .select('*')
      .order('sort_order')
    setPriorityCards((data ?? []) as PriorityCard[])
    setLoadingPriorities(false)
  }

  // ── Hero Carousel handlers ──────────────────────────────────────────────

  async function handleNewFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingSlide('new')
    try {
      const result = await uploadFile(file)
      if (result) {
        setNewSlide(s => ({ ...s, image_url: result.url, media_type: result.mediaType }))
      }
    } finally {
      setUploadingSlide(null)
      if (newFileInputRef.current) newFileInputRef.current.value = ''
    }
  }

  async function handleRowFileUpload(slideId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingSlide(slideId)
    try {
      const result = await uploadFile(file)
      if (result) {
        await updateSlide(slideId, 'image_url', result.url)
        await updateSlide(slideId, 'media_type', result.mediaType)
      }
    } finally {
      setUploadingSlide(null)
      const ref = rowFileInputRefs.current[slideId]
      if (ref) ref.value = ''
    }
  }

  async function addSlide() {
    if (!newSlide.image_url) return
    setSavingSlide('new')
    const { error } = await supabase.from('hero_carousel_items').insert({
      image_url: newSlide.image_url,
      alt_text: newSlide.alt_text || null,
      caption: newSlide.caption || null,
      sort_order: slides.length,
      is_active: true,
      media_type: newSlide.media_type,
    })
    if (!error) {
      setNewSlide({ image_url: '', alt_text: '', caption: '', media_type: 'image' })
      setShowAdd(false)
      await loadSlides()
    }
    setSavingSlide(null)
  }

  async function updateSlide(id: string, field: string, value: string | boolean) {
    setSavingSlide(id)
    await supabase.from('hero_carousel_items').update({ [field]: value }).eq('id', id)
    setSlides(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
    setSavingSlide(null)
  }

  async function deleteSlide(id: string) {
    if (!confirm('Remove this slide?')) return
    await supabase.from('hero_carousel_items').delete().eq('id', id)
    setSlides(prev => prev.filter(s => s.id !== id))
  }

  // ── Priorities handlers ─────────────────────────────────────────────────

  async function handlePriorityFileUpload(cardId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPriority(cardId)
    try {
      const result = await uploadFile(file)
      if (result) {
        await updatePriorityCard(cardId, 'image_url', result.url)
      }
    } finally {
      setUploadingPriority(null)
      const ref = priorityFileInputRefs.current[cardId]
      if (ref) ref.value = ''
    }
  }

  async function updatePriorityCard(id: string, field: string, value: string) {
    setSavingPriority(id)
    try {
      const res = await fetch(`/api/admin/priorities-cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      const json = await res.json()
      if (!json.ok) {
        alert('Save failed: ' + json.error)
        return
      }
      setPriorityCards(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
    } finally {
      setSavingPriority(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Homepage</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage content shown on the public homepage.</p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Hero Carousel Section                                             */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-zinc-900">Hero — Polaroid Carousel</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Each slide shows as a polaroid with a caption. Upload images or videos.</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 transition-colors"
          >
            <Plus size={14} /> Add slide
          </button>
        </div>

        {loadingSlides ? (
          <div className="px-6 py-8 text-sm text-zinc-400">Loading slides…</div>
        ) : slides.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <ImageIcon className="w-8 h-8 text-zinc-200 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">No slides yet. Add your first image.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {slides.map(slide => (
              <li key={slide.id} className="px-6 py-4 flex items-start gap-4">
                <GripVertical size={16} className="text-zinc-300 mt-1 flex-shrink-0" />

                {/* Preview */}
                <div className="relative w-20 h-16 rounded-md overflow-hidden bg-zinc-100 flex-shrink-0">
                  {slide.image_url ? (
                    slide.media_type === 'video' ? (
                      <video src={slide.image_url} className="w-full h-full object-cover" muted />
                    ) : (
                      <SafeImage
                        src={slide.image_url}
                        alt={slide.alt_text ?? ''}
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon size={16} className="text-zinc-300" />
                    </div>
                  )}
                </div>

                {/* Fields */}
                <div className="flex-1 grid grid-cols-1 gap-2">
                  {/* Upload button + URL field */}
                  <div className="flex gap-2 items-center">
                    <input
                      ref={el => { rowFileInputRefs.current[slide.id] = el }}
                      type="file"
                      accept="image/*,video/mp4,video/webm"
                      className="hidden"
                      onChange={e => handleRowFileUpload(slide.id, e)}
                    />
                    <button
                      type="button"
                      disabled={uploadingSlide === slide.id}
                      onClick={() => rowFileInputRefs.current[slide.id]?.click()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-zinc-200 rounded-md hover:border-zinc-400 text-zinc-600 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {uploadingSlide === slide.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Upload size={12} />}
                      {uploadingSlide === slide.id ? 'Uploading…' : 'Upload'}
                    </button>
                    <input
                      className="flex-1 text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      placeholder="or paste image/video URL"
                      defaultValue={slide.image_url}
                      onBlur={e => updateSlide(slide.id, 'image_url', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      placeholder="Caption (shown on polaroid)"
                      defaultValue={slide.caption ?? ''}
                      onBlur={e => updateSlide(slide.id, 'caption', e.target.value)}
                    />
                    <input
                      className="text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      placeholder="Alt text (for accessibility)"
                      defaultValue={slide.alt_text ?? ''}
                      onBlur={e => updateSlide(slide.id, 'alt_text', e.target.value)}
                    />
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={slide.is_active}
                      onChange={e => updateSlide(slide.id, 'is_active', e.target.checked)}
                      className="w-4 h-4 accent-zinc-900"
                    />
                    <span className="text-xs text-zinc-500">Active</span>
                  </label>
                  <button
                    onClick={() => deleteSlide(slide.id)}
                    className="text-zinc-300 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {savingSlide === slide.id && (
                  <span className="text-xs text-zinc-400 flex-shrink-0 mt-1">Saving…</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add slide form */}
        {showAdd && (
          <div className="px-6 py-4 border-t border-zinc-100 bg-zinc-50 space-y-3">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">New slide</p>

            {/* File upload or URL */}
            <div className="space-y-2">
              <input
                ref={newFileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm"
                className="hidden"
                onChange={handleNewFileUpload}
              />
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  disabled={uploadingSlide === 'new'}
                  onClick={() => newFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm border border-zinc-300 rounded-md hover:border-zinc-500 bg-white text-zinc-700 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {uploadingSlide === 'new'
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Upload size={14} />}
                  {uploadingSlide === 'new' ? 'Uploading…' : 'Upload file'}
                </button>
                <input
                  className="flex-1 text-sm border border-zinc-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  placeholder="or paste image/video URL"
                  value={newSlide.image_url}
                  onChange={e => setNewSlide(s => ({ ...s, image_url: e.target.value }))}
                />
              </div>
              {/* Preview if URL set */}
              {newSlide.image_url && (
                <div className="relative w-24 h-16 rounded-md overflow-hidden bg-zinc-100">
                  {newSlide.media_type === 'video' ? (
                    <video src={newSlide.image_url} className="w-full h-full object-cover" muted />
                  ) : (
                    <SafeImage
                      src={newSlide.image_url}
                      alt=""
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                className="text-sm border border-zinc-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="Caption (shown on polaroid)"
                value={newSlide.caption}
                onChange={e => setNewSlide(s => ({ ...s, caption: e.target.value }))}
              />
              <input
                className="text-sm border border-zinc-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder="Alt text"
                value={newSlide.alt_text}
                onChange={e => setNewSlide(s => ({ ...s, alt_text: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={addSlide}
                disabled={!newSlide.image_url || savingSlide === 'new'}
                className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-40 transition-colors"
              >
                {savingSlide === 'new' ? 'Adding…' : 'Add'}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Priorities Section                                                */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-zinc-100">
          <h2 className="font-semibold text-zinc-900">Priorities — &quot;We Got Our Priorities Straight&quot;</h2>
          <p className="text-xs text-zinc-400 mt-0.5">5 polaroid cards with image, title, and description. Upload images and edit text.</p>
        </div>

        {loadingPriorities ? (
          <div className="px-6 py-8 text-sm text-zinc-400">Loading cards…</div>
        ) : priorityCards.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <ImageIcon className="w-8 h-8 text-zinc-200 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">No priority cards found in the database.</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {priorityCards.map((card, idx) => (
              <li key={card.id} className="px-6 py-5 flex items-start gap-4">
                {/* Card number */}
                <div className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center text-xs font-medium text-zinc-500 flex-shrink-0 mt-1">
                  {idx + 1}
                </div>

                {/* Image preview */}
                <div className="relative w-24 h-20 rounded-md overflow-hidden bg-zinc-100 flex-shrink-0">
                  {card.image_url ? (
                    <SafeImage
                      src={card.image_url}
                      alt={card.alt_text ?? ''}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon size={20} className="text-zinc-300" />
                    </div>
                  )}
                </div>

                {/* Fields */}
                <div className="flex-1 space-y-2">
                  {/* Upload + URL */}
                  <div className="flex gap-2 items-center">
                    <input
                      ref={el => { priorityFileInputRefs.current[card.id] = el }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => handlePriorityFileUpload(card.id, e)}
                    />
                    <button
                      type="button"
                      disabled={uploadingPriority === card.id}
                      onClick={() => priorityFileInputRefs.current[card.id]?.click()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-zinc-200 rounded-md hover:border-zinc-400 text-zinc-600 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {uploadingPriority === card.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Upload size={12} />}
                      {uploadingPriority === card.id ? 'Uploading…' : 'Upload image'}
                    </button>
                    <input
                      className="flex-1 text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      placeholder="or paste image URL"
                      defaultValue={card.image_url}
                      onBlur={e => updatePriorityCard(card.id, 'image_url', e.target.value)}
                    />
                  </div>
                  {/* Title + Alt */}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      placeholder="Card title"
                      defaultValue={card.title}
                      onBlur={e => updatePriorityCard(card.id, 'title', e.target.value)}
                    />
                    <input
                      className="text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      placeholder="Alt text"
                      defaultValue={card.alt_text ?? ''}
                      onBlur={e => updatePriorityCard(card.id, 'alt_text', e.target.value)}
                    />
                  </div>
                  {/* Body text */}
                  <textarea
                    className="w-full text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
                    placeholder="Card description"
                    rows={2}
                    defaultValue={card.body}
                    onBlur={e => updatePriorityCard(card.id, 'body', e.target.value)}
                  />
                </div>

                {/* Saving indicator */}
                {savingPriority === card.id && (
                  <span className="text-xs text-zinc-400 flex-shrink-0 mt-1">Saving…</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

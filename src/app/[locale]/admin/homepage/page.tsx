'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Trash2, GripVertical, Image as ImageIcon, Upload, Loader2 } from 'lucide-react'

type Slide = {
  id: string
  image_url: string
  alt_text: string | null
  caption: string | null
  sort_order: number
  is_active: boolean
  media_type: string | null
}

export default function HomepageAdminPage() {
  const supabase = createClient()
  const [slides, setSlides] = useState<Slide[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newSlide, setNewSlide] = useState({ image_url: '', alt_text: '', caption: '', media_type: 'image' })
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const rowFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('hero_carousel_items')
      .select('*')
      .order('sort_order')
    setSlides((data ?? []) as Slide[])
    setLoading(false)
  }

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

  async function handleNewFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading('new')
    try {
      const result = await uploadFile(file)
      if (result) {
        setNewSlide(s => ({ ...s, image_url: result.url, media_type: result.mediaType }))
      }
    } finally {
      setUploading(null)
      if (newFileInputRef.current) newFileInputRef.current.value = ''
    }
  }

  async function handleRowFileUpload(slideId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(slideId)
    try {
      const result = await uploadFile(file)
      if (result) {
        await updateSlide(slideId, 'image_url', result.url)
        await updateSlide(slideId, 'media_type', result.mediaType)
      }
    } finally {
      setUploading(null)
      const ref = rowFileInputRefs.current[slideId]
      if (ref) ref.value = ''
    }
  }

  async function addSlide() {
    if (!newSlide.image_url) return
    setSaving('new')
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
      await load()
    }
    setSaving(null)
  }

  async function updateSlide(id: string, field: string, value: string | boolean) {
    setSaving(id)
    await supabase.from('hero_carousel_items').update({ [field]: value }).eq('id', id)
    setSlides(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
    setSaving(null)
  }

  async function deleteSlide(id: string) {
    if (!confirm('Remove this slide?')) return
    await supabase.from('hero_carousel_items').delete().eq('id', id)
    setSlides(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Homepage</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage content shown on the public homepage.</p>
      </div>

      {/* Hero Section */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-zinc-900">Hero — Polaroid Carousel</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Each slide shows as a polaroid with a caption. Upload images or videos. Drag to reorder (coming soon).</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 transition-colors"
          >
            <Plus size={14} /> Add slide
          </button>
        </div>

        {loading ? (
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
                <div className="w-20 h-16 rounded-md overflow-hidden bg-zinc-100 flex-shrink-0">
                  {slide.image_url ? (
                    slide.media_type === 'video' ? (
                      <video src={slide.image_url} className="w-full h-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slide.image_url} alt={slide.alt_text ?? ''} className="w-full h-full object-cover" />
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
                      disabled={uploading === slide.id}
                      onClick={() => rowFileInputRefs.current[slide.id]?.click()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-zinc-200 rounded-md hover:border-zinc-400 text-zinc-600 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {uploading === slide.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Upload size={12} />}
                      {uploading === slide.id ? 'Uploading…' : 'Upload'}
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

                {saving === slide.id && (
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
                  disabled={uploading === 'new'}
                  onClick={() => newFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm border border-zinc-300 rounded-md hover:border-zinc-500 bg-white text-zinc-700 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {uploading === 'new'
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Upload size={14} />}
                  {uploading === 'new' ? 'Uploading…' : 'Upload file'}
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
                <div className="w-24 h-16 rounded-md overflow-hidden bg-zinc-100">
                  {newSlide.media_type === 'video' ? (
                    <video src={newSlide.image_url} className="w-full h-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={newSlide.image_url} alt="" className="w-full h-full object-cover" />
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
                disabled={!newSlide.image_url || saving === 'new'}
                className="px-4 py-1.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-40 transition-colors"
              >
                {saving === 'new' ? 'Adding…' : 'Add'}
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
    </div>
  )
}

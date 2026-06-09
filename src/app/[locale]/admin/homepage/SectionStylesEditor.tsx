'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, Loader2, RotateCcw } from 'lucide-react'
import { SECTION_DEFS } from '@/lib/homepage/section-styles'
import { downscaleImage } from '@/lib/images/client-downscale'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// ── Types (mirror the DB row) ─────────────────────────────────────────────────

interface StyleRow {
  section_key: string
  background: { webp: string; color: string; avif?: string } | null
  text_colors: Record<string, string>
  decoration_image_url?: string | null
  decoration_image_url_2?: string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SectionStylesEditor() {
  const [styles, setStyles] = useState<Record<string, StyleRow>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // `${section}:bg` | `${section}:${role}`
  const [hexDraft, setHexDraft] = useState<Record<string, string>>({}) // in-progress hex typing per `${section}:${role}`
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const polaroidRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/homepage-styles')
      const json = await res.json()
      if (json.ok) {
        const map: Record<string, StyleRow> = {}
        for (const r of json.data.styles as StyleRow[]) map[r.section_key] = r
        setStyles(map)
      }
    } finally {
      setLoading(false)
    }
  }

  async function uploadBackground(section: string, file: File) {
    setBusy(`${section}:bg`)
    try {
      const blob = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', blob, 'texture.jpg')
      const res = await fetch(`/api/admin/homepage-styles/${section}/background`, { method: 'POST', body: fd })
      // Read defensively — a body-limit/timeout error may not be JSON.
      const text = await res.text()
      let json: { ok?: boolean; error?: string } | null = null
      try { json = JSON.parse(text) } catch { /* non-JSON response */ }
      if (res.ok && json?.ok) {
        await load() // re-fetch so the swatch reflects exactly what's in the DB
      } else {
        alert('Upload failed: ' + (json?.error || `${res.status} ${res.statusText || 'error'}`))
      }
    } catch (e) {
      alert('Upload failed: ' + (e instanceof Error ? e.message : 'unexpected error'))
    } finally {
      setBusy(null)
      const ref = fileRefs.current[section]
      if (ref) ref.value = ''
    }
  }

  async function patch(section: string, body: unknown) {
    const res = await fetch(`/api/admin/homepage-styles/${section}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (json.ok) await load() // re-fetch so UI always matches DB
    else alert('Save failed: ' + json.error)
  }

  async function clearBackground(section: string) {
    setBusy(`${section}:bg`)
    try { await patch(section, { clearBackground: true }) }
    finally { setBusy(null) }
  }

  async function setColor(section: string, role: string, value: string | null) {
    setBusy(`${section}:${role}`)
    try { await patch(section, { text_colors: { [role]: value } }) }
    finally { setBusy(null) }
  }

  // Decorative Polaroid image: upload via the hero route, then save its URL.
  type PolaroidField = 'decoration_image_url' | 'decoration_image_url_2'
  async function uploadPolaroid(section: string, field: PolaroidField, file: File) {
    setBusy(`${section}:${field}`)
    try {
      const blob = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', blob, 'polaroid.jpg')
      const res = await fetch('/api/admin/hero/upload', { method: 'POST', body: fd })
      const text = await res.text()
      let json: { ok?: boolean; error?: string; data?: { url: string } } | null = null
      try { json = JSON.parse(text) } catch { /* non-JSON */ }
      if (res.ok && json?.ok && json.data) {
        await patch(section, { [field]: json.data.url })
      } else {
        alert('Upload failed: ' + (json?.error || `${res.status} ${res.statusText || 'error'}`))
      }
    } catch (e) {
      alert('Upload failed: ' + (e instanceof Error ? e.message : 'unexpected error'))
    } finally {
      setBusy(null)
      const ref = polaroidRefs.current[`${section}:${field}`]
      if (ref) ref.value = ''
    }
  }

  async function removePolaroid(section: string, field: PolaroidField) {
    setBusy(`${section}:${field}`)
    try { await patch(section, { [field]: '' }) }
    finally { setBusy(null) }
  }

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden mb-8">
      <div className="px-6 py-4 border-b border-zinc-100">
        <h2 className="font-semibold text-zinc-900">Section backgrounds &amp; colors</h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Upload a background texture and set the heading / tagline / body colours for each homepage section.
          Leave a colour untouched to keep the current design.
        </p>
      </div>

      {loading ? (
        <div className="px-6 py-8 text-sm text-zinc-400">Loading…</div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {SECTION_DEFS.map(def => {
            const row = styles[def.key]
            const bg = row?.background ?? null
            const colors = row?.text_colors ?? {}
            const bgBusy = busy === `${def.key}:bg`

            return (
              <li key={def.key} className="px-6 py-5 flex flex-col sm:flex-row sm:items-start gap-5">
                {/* Section name */}
                <div className="sm:w-56 flex-shrink-0">
                  <p className="font-medium text-zinc-900 text-sm">{def.label}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {def.roles.length > 0
                      ? def.roles.map(r => r.label).join(' · ')
                      : 'Background only'}
                  </p>
                </div>

                {/* Background swatch + upload */}
                <div className="flex items-center gap-3">
                  <div
                    className={`w-16 h-12 rounded-md border border-zinc-200 overflow-hidden flex-shrink-0 ${bg ? '' : (def.defaultBgClass || 'bg-[var(--color-sand)]')}`}
                    style={bg ? { backgroundColor: bg.color, backgroundImage: `url(${bg.webp})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    title={bg ? 'Custom texture' : 'Default texture'}
                  />
                  <div className="flex flex-col gap-1">
                    <input
                      ref={el => { fileRefs.current[def.key] = el }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/avif"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void uploadBackground(def.key, f) }}
                    />
                    <button
                      type="button"
                      disabled={bgBusy}
                      onClick={() => fileRefs.current[def.key]?.click()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-zinc-200 rounded-md hover:border-zinc-400 text-zinc-600 transition-colors disabled:opacity-50"
                    >
                      {bgBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                      {bgBusy ? 'Uploading…' : 'Upload texture'}
                    </button>
                    {bg && (
                      <button
                        type="button"
                        disabled={bgBusy}
                        onClick={() => void clearBackground(def.key)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                      >
                        <RotateCcw size={11} /> Reset to default
                      </button>
                    )}
                  </div>
                </div>

                {/* Decorative Polaroid images (sections that support them) */}
                {def.polaroid && (
                  <div className="flex flex-wrap items-start gap-4">
                    {([
                      { field: 'decoration_image_url', label: 'Polaroid 1', url: row?.decoration_image_url },
                      { field: 'decoration_image_url_2', label: 'Polaroid 2', url: row?.decoration_image_url_2 },
                    ] as const).map(({ field, label, url }) => {
                      const pbusy = busy === `${def.key}:${field}`
                      return (
                        <div key={field} className="flex items-center gap-2">
                          <div
                            className="w-12 h-12 rounded-md border border-zinc-200 overflow-hidden flex-shrink-0 bg-zinc-50"
                            style={url ? { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                            title={label}
                          />
                          <div className="flex flex-col gap-1">
                            <input
                              ref={el => { polaroidRefs.current[`${def.key}:${field}`] = el }}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadPolaroid(def.key, field, f) }}
                            />
                            <button
                              type="button"
                              disabled={pbusy}
                              onClick={() => polaroidRefs.current[`${def.key}:${field}`]?.click()}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-zinc-200 rounded-md hover:border-zinc-400 text-zinc-600 transition-colors disabled:opacity-50"
                            >
                              {pbusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                              {pbusy ? 'Uploading…' : label}
                            </button>
                            {url && (
                              <button
                                type="button"
                                disabled={pbusy}
                                onClick={() => void removePolaroid(def.key, field)}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-700"
                              >
                                <RotateCcw size={11} /> Remove
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Text colour pickers — swatch + editable HEX field */}
                {def.roles.length > 0 && (
                  <div className="flex flex-wrap gap-4 sm:ml-auto">
                    {def.roles.map(role => {
                      const key = `${def.key}:${role.key}`
                      const overridden = role.key in colors
                      const current = colors[role.key] ?? role.default
                      const draft = hexDraft[key] ?? current
                      const colorVal = HEX_RE.test(draft) ? draft : current
                      const roleBusy = busy === key
                      const clearDraft = () => setHexDraft(d => { const n = { ...d }; delete n[key]; return n })
                      const commit = (v: string) => {
                        clearDraft()
                        if (HEX_RE.test(v) && v.toLowerCase() !== current.toLowerCase()) void setColor(def.key, role.key, v.toLowerCase())
                      }
                      return (
                        <div key={role.key} className="flex flex-col items-start gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{role.label}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={colorVal}
                              disabled={roleBusy}
                              onChange={e => setHexDraft(d => ({ ...d, [key]: e.target.value }))}
                              onBlur={e => commit(e.target.value)}
                              className="w-8 h-8 rounded cursor-pointer border border-zinc-200 bg-white disabled:opacity-50 p-0"
                            />
                            <input
                              type="text"
                              value={draft}
                              disabled={roleBusy}
                              spellCheck={false}
                              maxLength={7}
                              placeholder="#000000"
                              onChange={e => {
                                let v = e.target.value.trim()
                                if (v && !v.startsWith('#')) v = '#' + v
                                setHexDraft(d => ({ ...d, [key]: v }))
                              }}
                              onBlur={e => commit(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              className="w-[78px] px-1.5 py-1 text-xs font-mono uppercase border border-zinc-200 rounded focus:outline-none focus:ring-2 focus:ring-zinc-300 disabled:opacity-50"
                            />
                            {roleBusy && <Loader2 size={12} className="animate-spin text-zinc-300" />}
                            {overridden && !roleBusy && (
                              <button
                                type="button"
                                onClick={() => { clearDraft(); void setColor(def.key, role.key, null) }}
                                title="Reset to default colour"
                                className="text-zinc-300 hover:text-zinc-600 transition-colors"
                              >
                                <RotateCcw size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

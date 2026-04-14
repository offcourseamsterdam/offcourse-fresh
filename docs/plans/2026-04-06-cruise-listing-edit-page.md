# Cruise Listing Edit Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full-featured tabbed edit page at `/admin/cruises/[id]` for cruise listings, with image upload to Supabase Storage and per-tab save.

**Architecture:** Creation form redirects to the edit page after save. The edit page loads the listing via a new GET API route and PATCHes only the active tab's fields on save. Images upload to Supabase Storage bucket `cruise-images` via a dedicated API route, then the URL is appended to the listing's `images` JSONB column.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (DB + Storage), existing `src/components/ui/` primitives (tabs, button, input, card, badge)

---

## Task 1: Create Supabase Storage bucket

**Files:**
- Create: `supabase/migrations/007_cruise_images_bucket.sql`

**Step 1: Write the migration**

```sql
-- Create public storage bucket for cruise listing images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cruise-images',
  'cruise-images',
  true,
  10485760, -- 10MB per file
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read
CREATE POLICY "public read cruise images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cruise-images');

-- Allow service role to upload/delete
CREATE POLICY "service role manage cruise images"
  ON storage.objects FOR ALL
  USING (bucket_id = 'cruise-images');
```

**Step 2: Run in Supabase SQL editor**

Navigate to Supabase → SQL editor → paste and run. Verify bucket appears in Storage tab.

**Step 3: Commit**

```bash
git add supabase/migrations/007_cruise_images_bucket.sql
git commit -m "feat: add cruise-images Supabase Storage bucket"
```

---

## Task 2: GET + PATCH API route for single listing

**Files:**
- Create: `src/app/api/admin/cruise-listings/[id]/route.ts`

**Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/admin/cruise-listings/[id]
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
  return NextResponse.json({ ok: true, data })
}

// PATCH /api/admin/cruise-listings/[id]
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const body = await req.json()

  // Whitelist patchable fields (anything on cruise_listings is fair game)
  const allowed = [
    'title','title_nl','title_de','title_fr','title_es','title_pt','title_zh',
    'tagline','tagline_nl','tagline_de','tagline_fr','tagline_es','tagline_pt','tagline_zh',
    'description','description_nl','description_de','description_fr','description_es','description_pt','description_zh',
    'price_display','price_label','starting_price',
    'seo_title','seo_meta_description',
    'seo_title_nl','seo_title_de','seo_title_fr','seo_title_es','seo_title_pt','seo_title_zh',
    'seo_meta_description_nl','seo_meta_description_de','seo_meta_description_fr',
    'seo_meta_description_es','seo_meta_description_pt','seo_meta_description_zh',
    'allowed_resource_pks','allowed_customer_type_pks','availability_filters',
    'display_order','is_published','is_featured','category','departure_location',
    'hero_image_url','benefits','highlights','inclusions','faqs','images',
    'cancellation_policy','duration_display','max_guests','slug',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('cruise_listings')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data })
}
```

**Step 2: Verify manually**

Start dev server. In browser console or Postman:
```
GET http://localhost:3000/api/admin/cruise-listings/{a-real-id}
→ expect { ok: true, data: { id: ..., title: ... } }
```

**Step 3: Commit**

```bash
git add src/app/api/admin/cruise-listings/[id]/route.ts
git commit -m "feat: add GET + PATCH API route for single cruise listing"
```

---

## Task 3: Image upload API route

**Files:**
- Create: `src/app/api/admin/cruise-listings/images/route.ts`

**Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const listingId = formData.get('listingId') as string | null

  if (!file || !listingId) {
    return NextResponse.json({ ok: false, error: 'file and listingId are required' }, { status: 400 })
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${listingId}/${uuidv4()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const supabase = await createServiceClient()
  const { error: uploadError } = await supabase.storage
    .from('cruise-images')
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from('cruise-images')
    .getPublicUrl(path)

  return NextResponse.json({ ok: true, url: publicUrl, path })
}
```

**Step 2: Install uuid if not already present**

```bash
cd "/Users/beer/Desktop/Next.JS Off Course Amsterdam"
npm list uuid 2>/dev/null | grep uuid || npm install uuid && npm install --save-dev @types/uuid
```

**Step 3: Commit**

```bash
git add src/app/api/admin/cruise-listings/images/route.ts
git commit -m "feat: add image upload API route for cruise listings"
```

---

## Task 4: Redirect creation form to edit page

**Files:**
- Modify: `src/app/[locale]/admin/cruises/page.tsx`

**Step 1: Add router and params hooks at top of component**

Add imports:
```typescript
import { useRouter, useParams } from 'next/navigation'
```

Add inside `AdminCruisesPage()`:
```typescript
const router = useRouter()
const params = useParams()
const locale = (params.locale as string) ?? 'en'
```

**Step 2: Update `saveListing` to redirect on success**

Replace this block:
```typescript
if (json.ok) {
  setShowForm(false)
  setForm({ fareharbor_item_pk: 0, slug: '', title: '', category: 'private', allowed_resource_pks: [], allowed_customer_type_pks: [], availability_filters: '{}' })
  loadListings()
}
```

With:
```typescript
if (json.ok) {
  router.push(`/${locale}/admin/cruises/${json.data.id}`)
}
```

**Step 3: Verify**

Create a listing in the UI → should navigate to `/en/admin/cruises/{id}` (404 for now, edit page not built yet — that's fine).

**Step 4: Commit**

```bash
git add src/app/[locale]/admin/cruises/page.tsx
git commit -m "feat: redirect to edit page after creating cruise listing"
```

---

## Task 5: Edit page skeleton + header + tab shell

**Files:**
- Create: `src/app/[locale]/admin/cruises/[id]/page.tsx`

**Step 1: Create the file**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

interface CruiseListing {
  id: string
  slug: string
  title: string
  tagline: string | null
  description: string | null
  category: string
  departure_location: string | null
  duration_display: string | null
  max_guests: number | null
  starting_price: number | null
  price_display: string | null
  price_label: string | null
  hero_image_url: string | null
  images: Array<{ url: string; alt_text?: string }>
  benefits: Array<{ text: string; icon?: string }>
  highlights: Array<{ text: string }>
  inclusions: Array<{ text: string }>
  faqs: Array<{ question: string; answer: string }>
  cancellation_policy: { text?: string } | null
  allowed_resource_pks: number[]
  allowed_customer_type_pks: number[]
  availability_filters: Record<string, unknown>
  is_published: boolean
  is_featured: boolean
  display_order: number
  seo_title: string | null
  seo_meta_description: string | null
  fareharbor_item_pk: number
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CruiseEditPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const locale = (params.locale as string) ?? 'en'

  const [listing, setListing] = useState<CruiseListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/cruise-listings/${id}`)
    const json = await res.json()
    if (json.ok) setListing(json.data)
    else setNotFound(true)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

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
        <Link href={`/${locale}/admin/cruises`} className="text-sm text-zinc-400 underline mt-2 inline-block">
          ← Back to listings
        </Link>
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

      {/* Tabs */}
      <Tabs defaultValue="content">
        <TabsList className="w-full justify-start border-b border-zinc-200 bg-transparent rounded-none pb-0 h-auto gap-0">
          {['content', 'images', 'pricing', 'benefits', 'config', 'seo'].map(tab => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="capitalize rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:bg-transparent px-4 pb-2"
            >
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="content" className="pt-6">
          <p className="text-sm text-zinc-400">Content tab — coming in next task</p>
        </TabsContent>
        <TabsContent value="images" className="pt-6">
          <p className="text-sm text-zinc-400">Images tab — coming in next task</p>
        </TabsContent>
        <TabsContent value="pricing" className="pt-6">
          <p className="text-sm text-zinc-400">Pricing tab — coming in next task</p>
        </TabsContent>
        <TabsContent value="benefits" className="pt-6">
          <p className="text-sm text-zinc-400">Benefits tab — coming in next task</p>
        </TabsContent>
        <TabsContent value="config" className="pt-6">
          <p className="text-sm text-zinc-400">Config tab — coming in next task</p>
        </TabsContent>
        <TabsContent value="seo" className="pt-6">
          <p className="text-sm text-zinc-400">SEO tab — coming in next task</p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

**Step 2: Verify**

Navigate to `/en/admin/cruises/{a-real-id}` → should see header with listing title, badge, and 6 empty tabs.

**Step 3: Commit**

```bash
git add src/app/[locale]/admin/cruises/[id]/page.tsx
git commit -m "feat: add cruise edit page skeleton with header and tab shell"
```

---

## Task 6: Content tab

**Files:**
- Modify: `src/app/[locale]/admin/cruises/[id]/page.tsx`

**Step 1: Add a reusable `save` helper and `TabSaveButton` component at top of file (before the page component)**

```typescript
// ── Shared save helper ────────────────────────────────────────────────────

async function patchListing(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`/api/admin/cruise-listings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return res.json()
}

// ── Tab save button ───────────────────────────────────────────────────────

function TabSaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <div className="pt-6 flex items-center gap-3">
      <Button onClick={onClick} disabled={saving} size="sm">
        {saving ? <Loader2 className="animate-spin w-3.5 h-3.5 mr-1" /> : null}
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  )
}
```

**Step 2: Add `ContentTab` component**

```typescript
function ContentTab({ listing, onSave }: { listing: CruiseListing; onSave: (updated: CruiseListing) => void }) {
  const [form, setForm] = useState({
    title: listing.title ?? '',
    tagline: listing.tagline ?? '',
    description: listing.description ?? '',
    category: listing.category ?? 'private',
    departure_location: listing.departure_location ?? '',
    duration_display: listing.duration_display ?? '',
    max_guests: listing.max_guests ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, {
      ...form,
      max_guests: form.max_guests ? Number(form.max_guests) : null,
    })
    if (json.ok) onSave(json.data)
    else setError(json.error)
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <Field label="Title">
        <input className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
      </Field>
      <Field label="Tagline">
        <input className={inputCls} value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} placeholder="A short punchy line" />
      </Field>
      <Field label="Description">
        <textarea className={inputCls + ' min-h-[140px] resize-y'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </Field>
      <Field label="Category">
        <div className="flex gap-2">
          {['private','shared','standard'].map(cat => (
            <button key={cat} onClick={() => setForm(f => ({ ...f, category: cat }))}
              className={`px-3 py-1.5 rounded-md border text-xs capitalize transition-all ${form.category === cat ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white hover:border-zinc-400'}`}>
              {cat}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Departure location">
        <input className={inputCls} value={form.departure_location} onChange={e => setForm(f => ({ ...f, departure_location: e.target.value }))} placeholder="e.g. Prinsengracht 123" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration display">
          <input className={inputCls} value={form.duration_display} onChange={e => setForm(f => ({ ...f, duration_display: e.target.value }))} placeholder="e.g. 1.5 hours" />
        </Field>
        <Field label="Max guests">
          <input className={inputCls} type="number" value={form.max_guests} onChange={e => setForm(f => ({ ...f, max_guests: e.target.value }))} placeholder="8" />
        </Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}

// ── Shared primitives ────────────────────────────────────────────────────

const inputCls = 'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/20'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-600">{label}</label>
      {children}
    </div>
  )
}
```

**Step 3: Wire ContentTab into the page**

Replace `<TabsContent value="content">` placeholder with:
```typescript
<TabsContent value="content" className="pt-6">
  <ContentTab listing={listing} onSave={setListing} />
</TabsContent>
```

**Step 4: Verify**

Navigate to edit page → Content tab → edit title → Save → title updates in header immediately.

**Step 5: Commit**

```bash
git add src/app/[locale]/admin/cruises/[id]/page.tsx
git commit -m "feat: add Content tab to cruise listing edit page"
```

---

## Task 7: Images tab

**Files:**
- Modify: `src/app/[locale]/admin/cruises/[id]/page.tsx`

**Step 1: Add `ImagesTab` component**

```typescript
function ImagesTab({ listing, onSave }: { listing: CruiseListing; onSave: (updated: CruiseListing) => void }) {
  const [images, setImages] = useState<Array<{ url: string; alt_text?: string }>>(
    Array.isArray(listing.images) ? listing.images : []
  )
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
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
    setUploading(true)
    setError(null)
    const newImages = [...images]
    for (const file of Array.from(files)) {
      const result = await uploadFile(file)
      if (result.ok && result.url) {
        newImages.push({ url: result.url, alt_text: '' })
      } else {
        setError(result.error ?? 'Upload failed')
      }
    }
    setImages(newImages)
    // Auto-save images array + hero
    const heroUrl = newImages[0]?.url ?? listing.hero_image_url
    const json = await patchListing(listing.id, { images: newImages, hero_image_url: heroUrl })
    if (json.ok) onSave(json.data)
    setUploading(false)
  }

  async function setHero(url: string) {
    const json = await patchListing(listing.id, { hero_image_url: url })
    if (json.ok) onSave(json.data)
  }

  async function removeImage(url: string) {
    const updated = images.filter(i => i.url !== url)
    setImages(updated)
    const heroUrl = listing.hero_image_url === url ? (updated[0]?.url ?? null) : listing.hero_image_url
    const json = await patchListing(listing.id, { images: updated, hero_image_url: heroUrl })
    if (json.ok) onSave(json.data)
  }

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
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
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {images.map((img, i) => (
            <div key={img.url} className="relative group rounded-xl overflow-hidden aspect-video bg-zinc-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                {listing.hero_image_url !== img.url && (
                  <button onClick={() => setHero(img.url)}
                    className="text-xs bg-white text-zinc-900 px-2 py-1 rounded-md font-medium hover:bg-zinc-100">
                    Set as hero
                  </button>
                )}
                <button onClick={() => removeImage(img.url)}
                  className="text-xs bg-red-500 text-white px-2 py-1 rounded-md font-medium hover:bg-red-600">
                  Remove
                </button>
              </div>
              {listing.hero_image_url === img.url && (
                <div className="absolute top-2 left-2 bg-zinc-900 text-white text-xs px-1.5 py-0.5 rounded">
                  Hero
                </div>
              )}
              {i === 0 && listing.hero_image_url !== img.url && (
                <div className="absolute top-2 left-2 bg-zinc-500 text-white text-xs px-1.5 py-0.5 rounded">
                  1st
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
```

**Step 2: Add `useRef` to imports at top of file**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
```

**Step 3: Wire into page**

Replace `<TabsContent value="images">` placeholder with:
```typescript
<TabsContent value="images" className="pt-6">
  <ImagesTab listing={listing} onSave={setListing} />
</TabsContent>
```

**Step 4: Verify**

Images tab → drop an image file → should upload, appear in grid, set as hero automatically.

**Step 5: Commit**

```bash
git add src/app/[locale]/admin/cruises/[id]/page.tsx
git commit -m "feat: add Images tab with upload and hero selection"
```

---

## Task 8: Pricing tab

**Files:**
- Modify: `src/app/[locale]/admin/cruises/[id]/page.tsx`

**Step 1: Add `PricingTab` component**

```typescript
function PricingTab({ listing, onSave }: { listing: CruiseListing; onSave: (updated: CruiseListing) => void }) {
  const [form, setForm] = useState({
    starting_price: listing.starting_price ?? '',
    price_display: listing.price_display ?? '',
    price_label: listing.price_label ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, {
      starting_price: form.starting_price ? Number(form.starting_price) : null,
      price_display: form.price_display,
      price_label: form.price_label,
    })
    if (json.ok) onSave(json.data)
    else setError(json.error)
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-sm">
      <Field label="Starting price (€)">
        <input className={inputCls} type="number" value={form.starting_price}
          onChange={e => setForm(f => ({ ...f, starting_price: e.target.value }))} placeholder="165" />
        <p className="text-xs text-zinc-400 mt-1">Used for search results and structured data</p>
      </Field>
      <Field label="Price display text">
        <input className={inputCls} value={form.price_display}
          onChange={e => setForm(f => ({ ...f, price_display: e.target.value }))} placeholder="from €165" />
      </Field>
      <Field label="Price label">
        <input className={inputCls} value={form.price_label}
          onChange={e => setForm(f => ({ ...f, price_label: e.target.value }))} placeholder="per boat" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
```

**Step 2: Wire into page, verify, commit**

```typescript
// In JSX:
<TabsContent value="pricing" className="pt-6">
  <PricingTab listing={listing} onSave={setListing} />
</TabsContent>
```

```bash
git commit -am "feat: add Pricing tab to cruise listing edit page"
```

---

## Task 9: Benefits tab

**Files:**
- Modify: `src/app/[locale]/admin/cruises/[id]/page.tsx`

**Step 1: Add a reusable `ListEditor` component for simple text arrays**

```typescript
function ListEditor({
  label, items, onChange, placeholder,
}: {
  label: string
  items: Array<{ text: string }>
  onChange: (items: Array<{ text: string }>) => void
  placeholder?: string
}) {
  function update(i: number, text: string) {
    const next = [...items]
    next[i] = { ...next[i], text }
    onChange(next)
  }
  function remove(i: number) { onChange(items.filter((_, idx) => idx !== i)) }
  function add() { onChange([...items, { text: '' }]) }
  function move(i: number, dir: -1 | 1) {
    const next = [...items]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-zinc-600">{label}</label>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={inputCls} value={item.text} placeholder={placeholder}
            onChange={e => update(i, e.target.value)} />
          <button onClick={() => move(i, -1)} className="text-zinc-400 hover:text-zinc-600 text-xs px-1">↑</button>
          <button onClick={() => move(i, 1)} className="text-zinc-400 hover:text-zinc-600 text-xs px-1">↓</button>
          <button onClick={() => remove(i)} className="text-zinc-400 hover:text-red-500 text-xs px-1">×</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-zinc-500 hover:text-zinc-900 underline mt-1">+ Add item</button>
    </div>
  )
}
```

**Step 2: Add `FaqEditor` for Q+A pairs**

```typescript
function FaqEditor({ faqs, onChange }: { faqs: Array<{ question: string; answer: string }>; onChange: (f: Array<{ question: string; answer: string }>) => void }) {
  function update(i: number, field: 'question' | 'answer', val: string) {
    const next = [...faqs]
    next[i] = { ...next[i], [field]: val }
    onChange(next)
  }
  function remove(i: number) { onChange(faqs.filter((_, idx) => idx !== i)) }
  function add() { onChange([...faqs, { question: '', answer: '' }]) }
  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-zinc-600">FAQs</label>
      {faqs.map((faq, i) => (
        <div key={i} className="border border-zinc-200 rounded-lg p-3 space-y-2 bg-white">
          <div className="flex items-start justify-between gap-2">
            <input className={inputCls} placeholder="Question" value={faq.question}
              onChange={e => update(i, 'question', e.target.value)} />
            <button onClick={() => remove(i)} className="text-zinc-400 hover:text-red-500 text-xs mt-2 flex-shrink-0">×</button>
          </div>
          <textarea className={inputCls + ' min-h-[80px] resize-y'} placeholder="Answer" value={faq.answer}
            onChange={e => update(i, 'answer', e.target.value)} />
        </div>
      ))}
      <button onClick={add} className="text-xs text-zinc-500 hover:text-zinc-900 underline">+ Add FAQ</button>
    </div>
  )
}
```

**Step 3: Add `BenefitsTab` component**

```typescript
function BenefitsTab({ listing, onSave }: { listing: CruiseListing; onSave: (updated: CruiseListing) => void }) {
  const [benefits, setBenefits] = useState<Array<{ text: string }>>(
    Array.isArray(listing.benefits) ? listing.benefits : []
  )
  const [highlights, setHighlights] = useState<Array<{ text: string }>>(
    Array.isArray(listing.highlights) ? listing.highlights : []
  )
  const [inclusions, setInclusions] = useState<Array<{ text: string }>>(
    Array.isArray(listing.inclusions) ? listing.inclusions : []
  )
  const [faqs, setFaqs] = useState<Array<{ question: string; answer: string }>>(
    Array.isArray(listing.faqs) ? listing.faqs : []
  )
  const [cancellationPolicy, setCancellationPolicy] = useState(
    (listing.cancellation_policy as { text?: string } | null)?.text ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, {
      benefits,
      highlights,
      inclusions,
      faqs,
      cancellation_policy: { text: cancellationPolicy },
    })
    if (json.ok) onSave(json.data)
    else setError(json.error)
    setSaving(false)
  }

  return (
    <div className="space-y-8 max-w-xl">
      <ListEditor label="Benefits" items={benefits} onChange={setBenefits} placeholder="e.g. Free drinks included" />
      <ListEditor label="Highlights" items={highlights} onChange={setHighlights} placeholder="e.g. Hidden canal gems" />
      <ListEditor label="Inclusions" items={inclusions} onChange={setInclusions} placeholder="e.g. Bluetooth speaker" />
      <FaqEditor faqs={faqs} onChange={setFaqs} />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-600">Cancellation policy</label>
        <textarea className={inputCls + ' min-h-[100px] resize-y'} value={cancellationPolicy}
          onChange={e => setCancellationPolicy(e.target.value)}
          placeholder="Free cancellation up to 48 hours before departure…" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
```

**Step 4: Wire in, verify, commit**

```typescript
<TabsContent value="benefits" className="pt-6">
  <BenefitsTab listing={listing} onSave={setListing} />
</TabsContent>
```

```bash
git commit -am "feat: add Benefits tab with list editors and FAQ editor"
```

---

## Task 10: Config tab

**Files:**
- Modify: `src/app/[locale]/admin/cruises/[id]/page.tsx`

**Step 1: Add `ConfigTab` component**

The config tab needs the FH item's resources and customer_types to render checkboxes. Load the item from the `supabase-items` action.

```typescript
function ConfigTab({ listing, onSave }: { listing: CruiseListing; onSave: (updated: CruiseListing) => void }) {
  const [form, setForm] = useState({
    slug: listing.slug ?? '',
    allowed_resource_pks: listing.allowed_resource_pks ?? [],
    allowed_customer_type_pks: listing.allowed_customer_type_pks ?? [],
    availability_filters: JSON.stringify(listing.availability_filters ?? {}, null, 2),
    is_published: listing.is_published,
    is_featured: listing.is_featured,
    display_order: listing.display_order,
  })
  const [fhItem, setFhItem] = useState<{ resources: {fareharbor_pk:number;name:string}[]; customer_types: {fareharbor_pk:number;name:string;duration_minutes:number}[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/fareharbor-test?action=supabase-items')
      .then(r => r.json())
      .then(json => {
        if (json.ok) {
          const item = json.data.find((i: { fareharbor_pk: number }) => i.fareharbor_pk === listing.fareharbor_item_pk)
          if (item) setFhItem(item)
        }
      })
  }, [listing.fareharbor_item_pk])

  function togglePk(list: number[], pk: number) {
    return list.includes(pk) ? list.filter(p => p !== pk) : [...list, pk]
  }

  async function save() {
    setSaving(true)
    setError(null)
    let filters: Record<string, unknown> = {}
    try { filters = JSON.parse(form.availability_filters) } catch { /* keep empty */ }
    const json = await patchListing(listing.id, {
      slug: form.slug,
      allowed_resource_pks: form.allowed_resource_pks,
      allowed_customer_type_pks: form.allowed_customer_type_pks,
      availability_filters: filters,
      is_published: form.is_published,
      is_featured: form.is_featured,
      display_order: Number(form.display_order),
    })
    if (json.ok) onSave(json.data)
    else setError(json.error)
    setSaving(false)
  }

  return (
    <div className="space-y-6 max-w-xl">
      <Field label="Slug">
        <input className={inputCls} value={form.slug}
          onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
      </Field>

      {fhItem && fhItem.resources.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-600">Allowed boats (empty = all)</label>
          <div className="flex flex-wrap gap-2">
            {fhItem.resources.map(r => (
              <button key={r.fareharbor_pk}
                onClick={() => setForm(f => ({ ...f, allowed_resource_pks: togglePk(f.allowed_resource_pks, r.fareharbor_pk) }))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-all ${form.allowed_resource_pks.includes(r.fareharbor_pk) ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white hover:border-zinc-400'}`}>
                {r.name} <span className="opacity-60">· {r.fareharbor_pk}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {fhItem && fhItem.customer_types.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-600">Allowed durations (empty = all)</label>
          <div className="flex flex-wrap gap-2">
            {fhItem.customer_types.map(ct => (
              <button key={ct.fareharbor_pk}
                onClick={() => setForm(f => ({ ...f, allowed_customer_type_pks: togglePk(f.allowed_customer_type_pks, ct.fareharbor_pk) }))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-all ${form.allowed_customer_type_pks.includes(ct.fareharbor_pk) ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white hover:border-zinc-400'}`}>
                {ct.name} <span className="opacity-60">· {ct.duration_minutes}min</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Field label="Availability filters (JSON)">
        <textarea className={inputCls + ' font-mono text-xs min-h-[100px]'}
          value={form.availability_filters}
          onChange={e => setForm(f => ({ ...f, availability_filters: e.target.value }))} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.is_published}
            onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))} />
          Published
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.is_featured}
            onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))} />
          Featured
        </label>
      </div>

      <Field label="Display order">
        <input className={inputCls} type="number" value={form.display_order}
          onChange={e => setForm(f => ({ ...f, display_order: Number(e.target.value) }))} />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
```

**Step 2: Wire in, verify, commit**

```typescript
<TabsContent value="config" className="pt-6">
  <ConfigTab listing={listing} onSave={setListing} />
</TabsContent>
```

```bash
git commit -am "feat: add Config tab with FH checkboxes and publish toggle"
```

---

## Task 11: SEO tab

**Files:**
- Modify: `src/app/[locale]/admin/cruises/[id]/page.tsx`

**Step 1: Add `SeoTab` component**

```typescript
function SeoTab({ listing, onSave }: { listing: CruiseListing; onSave: (updated: CruiseListing) => void }) {
  const [form, setForm] = useState({
    seo_title: listing.seo_title ?? '',
    seo_meta_description: listing.seo_meta_description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, form)
    if (json.ok) onSave(json.data)
    else setError(json.error)
    setSaving(false)
  }

  const titleLen = form.seo_title.length
  const descLen = form.seo_meta_description.length

  return (
    <div className="space-y-4 max-w-xl">
      <Field label={`SEO title (${titleLen}/60)`}>
        <input className={inputCls} value={form.seo_title}
          onChange={e => setForm(f => ({ ...f, seo_title: e.target.value }))}
          placeholder="Private Canal Cruise Amsterdam — Off Course" />
        {titleLen > 60 && <p className="text-xs text-amber-600 mt-1">Over 60 characters — Google may truncate this</p>}
      </Field>
      <Field label={`Meta description (${descLen}/160)`}>
        <textarea className={inputCls + ' min-h-[100px] resize-y'} value={form.seo_meta_description}
          onChange={e => setForm(f => ({ ...f, seo_meta_description: e.target.value }))}
          placeholder="Explore Amsterdam's hidden canals on a private electric boat…" />
        {descLen > 160 && <p className="text-xs text-amber-600 mt-1">Over 160 characters — Google may truncate this</p>}
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
```

**Step 2: Wire in, verify, commit**

```typescript
<TabsContent value="seo" className="pt-6">
  <SeoTab listing={listing} onSave={setListing} />
</TabsContent>
```

```bash
git commit -am "feat: add SEO tab with character count hints"
```

---

## Task 12: Create storage bucket migration and run it

**Step 1: Run migration 007 in Supabase SQL editor**

(SQL from Task 1 above)

**Step 2: Verify in Supabase dashboard**

Storage → should show `cruise-images` bucket as Public.

**Step 3: End-to-end test**

1. Go to `/en/admin/cruises`
2. Create a new listing → should redirect to edit page
3. Fill in Content tab → Save → title in header updates
4. Go to Images tab → drop a photo → should upload and appear in grid
5. Go to Config tab → toggle Published → Save → badge in header changes

---

## Done

All 12 tasks complete. The cruise listing edit page is fully functional with 6 tabs, image upload to Supabase Storage, and per-tab saves.

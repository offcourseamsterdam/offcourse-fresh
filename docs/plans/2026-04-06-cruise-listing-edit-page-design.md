# Cruise Listing Edit Page — Design Doc

**Date:** 2026-04-06
**Status:** Approved

---

## What We're Building

A dedicated edit page for cruise listings at `/admin/cruises/[id]`, plus image upload to Supabase Storage. The creation form stays lean (FH item + slug + title + category) and redirects to the edit page after saving. All content editing happens on the edit page via 6 tabs.

---

## Routes & Files

| File | Purpose |
|------|---------|
| `src/app/[locale]/admin/cruises/[id]/page.tsx` | Edit page (client component, loads listing by id) |
| `src/app/api/admin/cruise-listings/[id]/route.ts` | GET single listing, PATCH to update |
| `src/app/api/admin/cruise-listings/images/route.ts` | POST to upload image to Supabase Storage |

**Creation flow change:** After POST to `/api/admin/cruise-listings`, redirect to `/admin/cruises/{id}` instead of staying on the list page.

---

## Edit Page Layout

### Header
- Back arrow → `/admin/cruises`
- Listing title (large)
- Published / Draft badge
- "View on site" link (opens `/cruises/{slug}` in new tab, only if published)

### Tabs

| Tab | Fields |
|-----|--------|
| **Content** | title, tagline, description, category, departure_location, duration_display, max_guests |
| **Images** | drag-and-drop upload area, image grid (delete + set-as-hero per image), hero_image_url auto-set |
| **Pricing** | starting_price (€ number input), price_display (text e.g. "from €165"), price_label (text e.g. "per boat") |
| **Benefits** | benefits[], highlights[], inclusions[], faqs[], cancellation_policy |
| **Config** | slug, allowed_resource_pks (checkboxes), allowed_customer_type_pks (checkboxes), availability_filters (JSON textarea), is_published toggle, is_featured toggle, display_order |
| **SEO** | seo_title, seo_meta_description |

Each tab has its own **Save** button. PATCH sends only that tab's fields — no full-page reload.

---

## Image Upload Flow

1. User drops file(s) on upload area or clicks to browse
2. Browser POSTs `multipart/form-data` to `/api/admin/cruise-listings/images` with `listingId` + file
3. API uploads to Supabase Storage bucket **`cruise-images`** at path `{listingId}/{uuid}-{original-filename}`
4. Returns the public URL
5. URL appended to listing's `images` JSONB array via PATCH to `[id]` route
6. Image appears in grid immediately (optimistic UI)
7. First uploaded image auto-sets `hero_image_url`; clicking "Set as hero" on any image updates it

### Supabase Storage
- Bucket: `cruise-images`
- Access: **public** (images served directly via CDN URL)
- RLS: service role key for uploads (admin only)

---

## JSONB Array Editing (Benefits, Highlights, Inclusions, FAQs)

Each array field gets a small list UI:
- **Benefits / Highlights / Inclusions**: one text input per item + delete ×, "Add item" button at bottom
- **FAQs**: two inputs per row (question + answer) + delete ×, "Add FAQ" button
- **Cancellation policy**: single textarea
- Reorder: up/down arrow buttons per row (simple, no drag-and-drop for now)

---

## Data Flow

```
Edit page loads
  → GET /api/admin/cruise-listings/[id]
  → Returns full cruise_listings row

User edits Content tab → clicks Save
  → PATCH /api/admin/cruise-listings/[id]
  → Body: { title, tagline, description, category, departure_location, duration_display, max_guests }
  → Returns updated row
  → Show success toast

User uploads image
  → POST /api/admin/cruise-listings/images (FormData)
  → Supabase Storage upload
  → Returns { url }
  → PATCH listing images[] JSONB
  → Image appears in grid
```

---

## Key Decisions

- **Per-tab save** — avoids losing work when switching tabs, and makes the API surface predictable (each tab patches a known subset of fields)
- **Supabase Storage over external CDN** — already in the stack, no extra service to configure
- **No drag-and-drop reorder for images (yet)** — up/down buttons are simpler and sufficient for v1
- **No multilingual fields in this build** — translations are a separate track (Track I: AI + SEO tools)
- **Separate images API route** — keeps multipart upload logic isolated from the main PATCH route

---

## Dependencies

- Supabase Storage bucket `cruise-images` must exist with public access
- `cruise_listings` table must have all JSONB columns (migration 004 ✓)
- Admin cruises list page redirects to edit page after create

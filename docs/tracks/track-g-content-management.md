# Track G: Content + Listing Management

**Phase:** 2
**Dependencies:** Track E (admin shell + auth)
**Parallel with:** Track F

## Objective
Build the admin content editors, most importantly the cruise listing creation wizard with the advanced filtering system. This is where the virtual product layer becomes manageable.

## Steps

### G1. FareHarbor Item Sync Viewer (`src/app/admin/content/fareharbor-items/`)
- View all synced FareHarbor items, resources, customer types
- "Sync now" button → triggers `/api/fareharbor/sync`
- Last sync timestamp
- Read-only — this data comes from FareHarbor, not editable here

### G2. Cruise Listing Creation Wizard (`src/app/admin/content/listings/`)

**This is the most important admin feature.** A multi-step wizard:

**Step 1: Select FareHarbor Item**
- Dropdown of synced items
- Shows: item name, type (private/shared), number of existing listings

**Step 2: Advanced Filter Setup**
After selecting FH item, show ALL resources and customer types for that item.

Resources section:
- Checkboxes for each boat (e.g., ☑ Diana, ☑ Curaçao)
- Unchecked = this boat won't appear in booking flow for this listing
- Shows: boat name, FH PK, capacity, max guests

Customer types section:
- Checkboxes for each boat+duration combo
- Shows: name, FH PK, price, duration, max guests
- Smart: if a resource is unchecked, grey out its customer types automatically

Time/date rules:
- Time after input (HH:MM)
- Time before input (HH:MM)
- Sunset mode toggle with offset and window inputs
- Max guests override input
- Month checkboxes (Jan–Dec)
- Day of week checkboxes (Mon–Sun)

Save as: `allowed_resource_pks`, `allowed_customer_type_pks`, `availability_filters` JSON

**Step 3: Content**
- Title (English) + "Generate translations" button → Claude Sonnet fills _nl, _de, etc.
- Tagline + translations
- Description (rich text editor) + translations
- Photo upload: drag-and-drop, reorder, mark hero image
  - Auto WebP conversion on upload
  - Auto alt-text generation via Google Gemini + Claude Sonnet
- Benefits list (add/remove/reorder)
- FAQ pairs (add/remove/reorder)
- Pricing display text + starting price

**Step 4: SEO**
- SEO title + meta description (English)
- "Auto-generate from content" button
- Slug (auto from title, editable)
- Generate translations for SEO fields

**Step 5: Review & Publish**
- Preview card (as it would appear on website)
- Toggle: is_published, is_featured
- Set display_order, category

### G3. Listing Editor (Edit Existing)
Same wizard but pre-populated. Changes to filters don't affect existing bookings.

### G4. Homepage Content Editor (`src/app/admin/content/homepage/`)
- Hero carousel: add/remove/reorder items from `hero_carousel_items`
- Tour cards: manage `homepage_tour_cards` (link to listings)
- Reviews: manage `social_proof_reviews`

### G5. Merch Product Editor (`src/app/admin/content/merch/`)
- CRUD for `merch_products`: name, description, price, stock per size
- Image management for `merch_images`
- AI translate product descriptions

### G6. Team Member Editor (`src/app/admin/content/team/`)
- CRUD for `team_members`: name, role, photo, Q&A pairs
- CRUD for `float_fam_members`

### G7. SEO Keyword Upload (`src/app/admin/seo/keywords/`)
- CSV/Excel upload to `seo_keywords` table
- Columns: keyword, language, search_volume, difficulty
- View/filter/sort keywords
- Shows which keywords have associated blog posts

### G8. On-Demand ISR Trigger
- Button in admin: "Revalidate site" → calls `/api/revalidate` with secret
- Auto-trigger on content save (cruise, homepage, merch updates)

## Verification Checklist
- [ ] FareHarbor items/resources/customer types display correctly
- [ ] Listing wizard: Step 1 shows items
- [ ] Listing wizard: Step 2 shows resources + customer types with checkboxes
- [ ] Listing wizard: Step 2 time/date rules save correctly as JSON
- [ ] Listing wizard: Step 3 content editor works with AI translations
- [ ] Listing wizard: Step 4 SEO auto-generates from content
- [ ] Listing wizard: Step 5 publishes and listing appears on website
- [ ] Editing an existing listing preserves all data
- [ ] Homepage editor updates reflected on homepage (after ISR)
- [ ] Merch editor creates/updates products correctly
- [ ] SEO keyword CSV upload works
- [ ] ISR revalidation triggers on content changes

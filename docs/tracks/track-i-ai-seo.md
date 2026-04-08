# Track I: AI Tools + SEO

**Phase:** 3
**Dependencies:** Phase 2 complete (needs admin shell, listing editor, image library table)
**Parallel with:** Tracks H, J (fully independent)

## Objective
Implement AI-powered image labeling (Google Gemini), content generation (Claude Sonnet), blog system, and SEO tools.

**READ:** `docs/implementation-plan.md` section 3.2 for the full AI architecture with company context.

## Steps

### I1. Company Context (`src/lib/ai/context.ts`)
- Define `OFF_COURSE_SYSTEM_PROMPT` — used by ALL Claude Sonnet calls
- Contains: company facts, brand voice, translation rules, key terms
- See implementation plan for the full prompt

### I2. Image Upload + WebP Conversion
- API route: `POST /api/images/upload`
- Accept image → convert to WebP via `sharp` → upload to Supabase Storage
- Store in `image_library` table with original + webp paths
- Extend existing `webp_conversion_log` tracking

### I3. AI Image Labeling (Google Gemini Vision)
- `src/lib/ai/vision.ts` — Gemini analyzes uploaded image
- Returns: description, tags, suggested_seo_filename, scene_type
- Auto-rename file to SEO-friendly name: `private-boat-tour-amsterdam-canals-sunset.webp`
- Triggered automatically on image upload (after WebP conversion)

### I4. AI Alt-Text Generation (Claude Sonnet)
- Takes Gemini's image description → Claude Sonnet generates alt-text in all 7 languages
- Stored in `image_library` alt_text columns
- One API call with JSON response for all languages

### I5. AI Translation Service (`src/lib/ai/translate.ts`)
- `translateContent(sourceText, sourceLang, targetLangs)` — batch translate
- Uses company context system prompt for brand-consistent translations
- Returns `Record<string, string>` (locale → translated text)
- Integrated into admin content editors as "Generate translations" button

### I6. Blog System
- Create `blog_posts` table (see implementation plan)
- Admin blog editor: `src/app/admin/content/blog/`
- "Generate blog post" flow:
  1. Admin selects target keyword(s) from `seo_keywords` table
  2. Claude Sonnet generates draft with company context + SEO optimization
  3. Admin reviews, edits, publishes
  4. Auto-translate to all 6 languages
- Public blog page: `src/app/[locale]/blog/[slug]/page.tsx` (ISR)
- Blog listing page: `src/app/[locale]/blog/page.tsx`

### I7. SEO Keyword Tracker
- Admin page showing all keywords from `seo_keywords`
- Which keywords have blog posts targeting them
- Which keywords are used in listing SEO fields
- Simple CRUD + CSV import (from Track G7)

### I8. AI-Generated Static UI Translations
- Build script: reads `messages/en.json` → Claude Sonnet → generates all other locale JSON files
- Run as npm script: `npm run translate-ui`
- Output committed to repo (not runtime generated)

## Verification Checklist
- [ ] Image upload converts to WebP
- [ ] Gemini labels uploaded image with description + tags
- [ ] Claude Sonnet generates alt-text in 7 languages
- [ ] Translation service returns correct JSON for all languages
- [ ] Blog post generation creates SEO-optimized content
- [ ] Blog pages render with proper SEO metadata
- [ ] Keyword tracker shows coverage status
- [ ] `npm run translate-ui` generates all locale files

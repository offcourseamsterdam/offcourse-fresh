# Codebase Refactoring Plan — Off Course Amsterdam

**Created:** 2026-04-07
**Status:** Ready for review
**Baseline:** 62 tests passing (3 test files), build clean

---

## Context

This is a site-wide refactoring plan for the Next.js Off Course Amsterdam codebase (~117 source files). The goal: improve code structure, readability, and maintainability **without changing any UI or functionality**. Every change is incremental, reversible, and verified by tests.

### What We Found

| Metric | Value |
|--------|-------|
| Source files | 117 |
| Files > 300 lines | 6 (excl. auto-generated types) |
| Duplicate "backup" files | 5 (1,450 dead lines) |
| Hardcoded color values | 67 occurrences in 14 files |
| API response shape patterns | 3 incompatible patterns across 22 routes |
| Test files before this plan | 0 |
| Test files now | 3 (62 tests covering core business logic) |

### What's Already Good

- Clean dependency graph, no circular imports
- Strong typing via auto-generated Supabase types + domain types
- Well-structured FareHarbor client (rate limiting, caching, retry, error types)
- Good domain module separation in `src/lib/`
- Consistent `@/` absolute imports throughout

---

## Testing Foundation (DONE)

Before any refactoring, we established a testing baseline:

| Test file | Tests | Covers |
|-----------|-------|--------|
| `src/lib/utils.test.ts` | 18 | formatPrice, formatDate, formatDuration, categorizeListings, slugify |
| `src/lib/extras/calculate.test.ts` | 14 | VAT calculation, per-person/fixed/percentage extras, ordering, informational exclusion |
| `src/lib/fareharbor/filters.test.ts` | 30 | 3-layer filter system, getValidTimeSlots, getAvailableDurations, getBoatStatus, getReasonCode, applyAllFilters integration |

**Run:** `npm test` (62 tests, ~400ms)
**Config:** `vitest.config.ts` with `@/` path alias

---

## Refactoring Steps (in execution order)

### Step 1: Delete duplicate "backup" files

**What:** Remove 5 macOS Finder-created "copy" files that are exact duplicates and never imported.

**Files to delete:**
- `src/components/booking/ExtrasStep 2.tsx` (417 lines)
- `src/components/admin/ExtrasTab 2.tsx` (328 lines)
- `src/lib/fareharbor/sync 2.ts` (152 lines)
- `src/lib/extras/calculate 2.ts` (134 lines)
- `src/lib/utils/image 2.ts`

**Risk:** None — grep confirms zero imports of these files.

**Verification:**
1. `npm test` — 62 tests pass (no change)
2. `npm run build` — clean build

---

### Step 2: Replace hardcoded hex colors with theme variables

**What:** Replace 67 occurrences of `#343499` and `#990000` with Tailwind theme classes (`text-primary`, `bg-accent`, etc.) that map to the CSS variables already defined in `globals.css`.

**Files (by occurrence count):**

| File | # | Key changes |
|------|---|-------------|
| `Footer.tsx` | 13 | `text-[#343499]` → `text-primary`, `border-[#990000]` → `border-accent` |
| `Navbar.tsx` | 12 | Same pattern |
| `FleetSection.tsx` | 9 | Same pattern |
| `SearchBar.tsx` | 8 | Same pattern |
| `FeaturedCruises.tsx` | 7 | Same pattern |
| `SearchResultCard.tsx` | 4 | Same pattern |
| `LocationSection.tsx` | 3 | Same pattern |
| `button.tsx` | 2 | Same pattern |
| `SearchResults.tsx` | 2 | Same pattern |
| `PrioritiesSection.tsx` | 2 | Same pattern |
| `HeroSection.tsx` | 1 | Same pattern |
| `WhatsAppButton.tsx` | 1 | Same pattern |
| `CategoryBadge.tsx` | 1 | Same pattern |

**Risk:** Low — CSS variables resolve to the exact same hex values.

**Verification:**
1. `npm test` — 62 tests pass
2. `npm run build` — clean
3. Visual comparison at 375px, 768px, 1280px via Chrome MCP — pixel-identical

---

### Step 3: Standardize API response shapes

**What:** Create `src/lib/api/response.ts` with `apiOk(data)` and `apiError(msg, status)` helpers, then migrate all 22 API routes to use the consistent `{ ok: boolean, data?: T, error?: string }` shape.

**New file:**
```
src/lib/api/response.ts  (~20 lines)
```

**Test additions:**
```
src/lib/api/response.test.ts  — tests for apiOk, apiError helpers
```

**Migration:** One route at a time, each a separate commit. Update client-side fetch calls to match.

**Risk:** Medium — touches both server and client code.

**Verification per route:**
1. `npm test` passes
2. `npm run build` passes
3. Manual smoke test of the endpoint (admin pages, search, etc.)

---

### Step 4: Centralize shared constants

**What:** Extract repeated inline constants to `src/lib/constants.ts`.

Constants to extract:
- `CATEGORY_EMOJI` map (repeated in admin extras + ExtrasStep)
- `PRICE_TYPES` labels
- Listing category values (`'private' | 'shared'`)

**New file:**
```
src/lib/constants.ts  (~30 lines)
```

**Test additions:**
```
src/lib/constants.test.ts  — snapshot tests for constant shapes
```

**Risk:** Low — pure extraction.

**Verification:**
1. `npm test` passes
2. `npm run build` passes
3. Grep for inline duplicates is clean

---

### Step 5: Decompose admin cruise editor (994 → ~150 lines)

**What:** Extract 7 tab panels + image section from the monolithic cruise editor page.

**Current:** `src/app/[locale]/admin/cruises/[id]/page.tsx` (994 lines)

**New files:**
```
src/components/admin/cruise-editor/
├── CruiseDetailsTab.tsx       (~150 lines)
├── CruiseBenefitsTab.tsx      (~100 lines)
├── CruiseHighlightsTab.tsx    (~100 lines)
├── CruiseInclusionsTab.tsx    (~100 lines)
├── CruiseFAQsTab.tsx          (~100 lines)
├── CruiseCancellationTab.tsx  (~80 lines)
├── CruiseExtrasTab.tsx        (~120 lines)
└── CruiseImagesSection.tsx    (~100 lines)
```

**Parent page** becomes a ~150-line orchestrator: loads data, manages tab state, passes props.

**Risk:** Low — each tab is already self-contained logic within the file. Pure extraction.

**Verification:**
1. `npm test` passes
2. `npm run build` passes
3. Visual comparison of admin cruise edit page — identical functionality
4. Test: edit a listing, switch between all tabs, save changes

---

### Step 6: Decompose SearchBar (342 → ~120 lines)

**What:** Extract date picker and guest selector panels into their own components.

**Current:** `src/components/search/SearchBar.tsx` (342 lines)

**New files:**
```
src/components/search/
├── SearchBar.tsx          (~120 lines — orchestrator)
├── DatePickerPanel.tsx    (~120 lines — calendar + month nav + date selection)
└── GuestSelectorPanel.tsx (~80 lines — guest count stepper)
```

**Risk:** Low — panels are already distinct visual sections.

**Verification:**
1. `npm test` passes
2. `npm run build` passes
3. Homepage search works: pick date, pick guests, search returns results
4. Mobile layout (375px) renders correctly — panels stack vertically
5. Desktop layout (1280px) renders correctly — horizontal pill

---

### Step 7: Decompose ExtrasStep (417 → ~150 lines)

**What:** Extract individual extra card rendering and category grouping.

**Current:** `src/components/booking/ExtrasStep.tsx` (417 lines)

**New files:**
```
src/components/booking/
├── ExtrasStep.tsx          (~150 lines — orchestrator)
├── ExtraCard.tsx           (~100 lines — single extra with image, price, toggle)
└── ExtraCategoryGroup.tsx  (~80 lines — group header + list of ExtraCards)
```

**Risk:** Low — extra cards and categories are already distinct render blocks.

**Verification:**
1. `npm test` passes (especially `calculate.test.ts` — pricing math unchanged)
2. `npm run build` passes
3. Booking flow: select extras, verify prices match, complete checkout simulation

---

### Step 8: Decompose admin extras page (778 → ~200 lines)

**What:** Extract data table, form modal, and image upload.

**Current:** `src/app/[locale]/admin/extras/page.tsx` (778 lines)

**New files:**
```
src/components/admin/extras/
├── ExtrasTable.tsx         (~200 lines — data table with sorting)
├── ExtrasFormModal.tsx     (~200 lines — create/edit modal + validation)
└── ExtrasImageUpload.tsx   (~100 lines — image upload for extras)
```

**Risk:** Low.

**Verification:**
1. `npm test` passes
2. `npm run build` passes
3. Admin extras page: create, edit, delete extras — all work

---

### Step 9: Decompose admin FareHarbor page (891 → ~200 lines)

**What:** Extract action panels from the FareHarbor testing page.

**Current:** `src/app/[locale]/admin/fareharbor/page.tsx` (891 lines)

**New files:**
```
src/components/admin/fareharbor/
├── FHItemsPanel.tsx         (~150 lines)
├── FHAvailabilityPanel.tsx  (~200 lines)
├── FHSyncPanel.tsx          (~150 lines)
└── FHBookingsPanel.tsx      (~150 lines)
```

**Risk:** Low. This page is admin-only and less frequently used.

**Verification:**
1. `npm test` passes
2. `npm run build` passes
3. Each FH panel renders and executes its action correctly

---

### Step 10: Replace DOM event communication with React Context

**What:** Replace `window.dispatchEvent(new CustomEvent(...))` between Navbar and HeroSection with a `SearchContext` provider.

**Current:** Navbar dispatches `'hero-search-exit'` and `'navbar-search'` events; HeroSection listens via `window.addEventListener`.

**New file:**
```
src/lib/search/SearchContext.tsx  (~40 lines)
```

**Modifications:**
- `src/app/[locale]/layout.tsx` — wrap with `SearchProvider`
- `src/components/layout/Navbar.tsx` — use `useSearch()` instead of `dispatchEvent`
- `src/components/sections/HeroSection.tsx` — use `useSearch()` instead of `addEventListener`

**Risk:** Low-medium — standard React pattern, but need to verify HMR.

**Verification:**
1. `npm test` passes
2. `npm run build` passes
3. Homepage: search from hero section works
4. Homepage: search from navbar works
5. Scroll behavior between hero/navbar search still correct

---

## Files Ranked by Priority

| Rank | File | Lines | Frequency | Steps |
|------|------|-------|-----------|-------|
| 1 | `admin/cruises/[id]/page.tsx` | 994 | Every listing edit | Step 5 |
| 2 | `admin/fareharbor/page.tsx` | 891 | Admin testing | Step 9 |
| 3 | `admin/extras/page.tsx` | 778 | Extras management | Step 8 |
| 4 | `booking/ExtrasStep.tsx` | 417 | Every checkout | Step 7 |
| 5 | `search/SearchBar.tsx` | 342 | Every homepage visit | Step 6 |
| 6 | `admin/ExtrasTab.tsx` | 328 | Inside cruise editor | Covered by Step 5 |
| 7 | 14 files with hardcoded hex | 67 occurrences | Brand consistency | Step 2 |
| 8 | 22 API routes | Inconsistent shapes | Every API call | Step 3 |

---

## Verification Protocol (every step)

```
1. npm test              → all tests pass (currently 62, grows as we add)
2. npm run build         → zero warnings, clean build
3. Visual regression     → screenshots at 375px, 768px, 1280px
4. Functional check      → test the user flow touched by the change
5. One commit per step   → clean git history, easy to revert
```

---

## Out of Scope (by design)

- Feature changes — no new functionality
- Performance optimization — separate concern
- Database/schema changes
- Dependency upgrades
- Adding SWR/React Query — changes data fetching patterns
- Supabase DAL/repository pattern — architectural change, not refactoring

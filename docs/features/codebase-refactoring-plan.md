# Codebase Refactoring Plan — Off Course Amsterdam

> **Purpose**: Identify areas for improved structure, readability, and maintainability without changing UI or functionality. All changes are incremental, low-risk, and backed by tests.
> 
> **Audit scope**: 82 components, 29 API routes, 25 pages, 20+ lib modules — every file read and assessed.

---

## Priority Tier 1 — Security (deploy within 48h)

These are not refactoring per se, but the audit uncovered security gaps that should be addressed first.

### 1.1 Add `requireRole(['admin'])` to all unprotected admin API routes

**Risk**: Any authenticated user can currently mutate cruise listings, extras, boats, and view all bookings.

| Route | Issue |
|-------|-------|
| `/api/admin/boats/route.ts` | No auth check |
| `/api/admin/bookings/local/route.ts` | Exposes customer PII |
| `/api/admin/cruise-listings/route.ts` | No auth check |
| `/api/admin/cruise-listings/[id]/route.ts` | No auth check |
| `/api/admin/cruise-listings/[id]/extras/route.ts` | No auth check |
| `/api/admin/cruise-listings/images/route.ts` | No auth check |
| `/api/admin/extras/route.ts` | No auth check |
| `/api/admin/extras/[id]/route.ts` | No auth check |
| `/api/admin/extras/[id]/image/route.ts` | No auth check |
| `/api/admin/fareharbor-test/route.ts` | No auth check |
| `/api/admin/migrate/route.ts` | Token-only, no role check |
| `/api/admin/booking-flow/*.ts` | No auth check |

**Fix**: Add the same 4-line guard used in the reviews routes:
```typescript
try { await requireRole(['admin']) } catch { return apiError('Unauthorized', 403) }
```

**Testing**: Verify each route returns 403 for non-admin users, 200 for admin.

### 1.2 Add input validation to public booking routes

| Route | Missing validation |
|-------|-------------------|
| `/api/booking-flow/create-intent/route.ts` | `category` not checked against enum, `durationMinutes` unbounded, `listingId` not verified against DB |
| `/api/booking-flow/book/route.ts` | Phone format, email format not validated |

**Fix**: Add Zod schemas or manual checks at route entry.

---

## Priority Tier 2 — Code Duplication (high impact, low risk)

### 2.1 Extract shared `ReviewCard` component

**Files**: `src/components/sections/ReviewsSection.tsx`, `src/components/sections/CruiseReviews.tsx`
**Issue**: 95% identical review card markup duplicated across both files.
**Fix**: Create `src/components/ui/ReviewCard.tsx` with a `size` prop (`'default' | 'compact'`). Both sections import and use it.
**Effect**: ~50 lines removed, single source of truth for review display.

### 2.2 Extract shared `GuestCounter` component

**Files**: `src/components/search/GuestSelectorPanel.tsx`, `src/components/booking/DateStep.tsx`, `src/components/booking/GuestStep.tsx`
**Issue**: Minus/plus button guest counter implemented 3 times with near-identical markup.
**Fix**: Create `src/components/ui/GuestCounter.tsx` with props: `value`, `onChange`, `min`, `max`, `label`.
**Effect**: ~60 lines removed, consistent guest counter behavior everywhere.

### 2.3 Extract shared `fmtDuration()` utility

**Files**: `src/components/booking/BoatDurationStep.tsx` (line 34), `src/components/checkout/BookingSummary.tsx` (line 23)
**Issue**: Identical duration formatting function in two files.
**Fix**: Move to `src/lib/utils.ts` (where other formatters already live).
**Effect**: ~12 lines removed, single source of truth.

### 2.4 Extract FareHarbor parsing helpers

**Files**: `src/lib/fareharbor/config.ts`, `src/lib/fareharbor/sync.ts`
**Issue**: `parseBoatName()`, `parseDurationMinutes()`, `getMaxGuests()` duplicated with inconsistent return types.
**Fix**: Create `src/lib/fareharbor/parsing.ts` with consistent types. Both files import from it.
**Effect**: ~40 lines removed, consistent boat name types.

---

## Priority Tier 3 — Large Component Splits (medium impact, low risk)

### 3.1 Split `BookingPanel.tsx` (457 lines)

**Current**: Single file with reducer, state management, step rendering, and checkout flow.
**Proposed split**:
- `src/components/booking/useBookingReducer.ts` — reducer + types + initial state (~100 lines)
- `src/components/booking/BookingPanel.tsx` — rendering only (~350 lines)

**Testing**: Existing booking flow must work identically. Test date → timeslot → extras → checkout flow.

### 3.2 Split `Navbar.tsx` (290 lines)

**Current**: Contains mobile menu, language switcher, auth indicator, nav links.
**Proposed split**:
- `src/components/layout/LanguageSwitcher.tsx` — locale dropdown (~50 lines)
- `src/components/layout/Navbar.tsx` — main nav (~240 lines)

**Testing**: Navbar renders correctly on all pages, language switching works, mobile menu opens/closes.

---

## Priority Tier 4 — Error Handling & Type Safety (medium impact)

### 4.1 Replace silent `catch {}` blocks

**Files and count**:
| File | Silent catches | Risk |
|------|---------------|------|
| `src/lib/supabase/server.ts` | 2 | Cookie errors invisible |
| `src/lib/fareharbor/client.ts` | 2 | API failures invisible |
| `src/lib/fareharbor/availability.ts` | 1 | Availability failures invisible |
| `src/lib/fareharbor/sunset.ts` | 4 | Intentional graceful degradation |

**Fix**: Add `console.warn()` with context to non-intentional catches. Keep sunset.ts catches silent (documented as graceful fallback).

### 4.2 Remove `as any` casts in `sunset.ts`

**Issue**: 4 instances of `.from('sunset_times' as any)` with TODO comments.
**Fix**: Create the `sunset_times` table migration, add it to Supabase types, remove casts.
**Effect**: Proper type safety, no runtime surprises.

### 4.3 Fix unsafe type cast in `create-intent.ts`

**File**: `src/lib/booking/create-intent.ts` (line 55)
**Issue**: `(extras ?? []) as any` loses type safety.
**Fix**: Type the extras parameter properly as `Extra[]`.

### 4.4 Remove deprecated `getCustomerTypeMap()` 

**File**: `src/lib/fareharbor/config.ts` (line 81)
**Issue**: Marked `@deprecated`, always returns empty Map.
**Fix**: Remove function, verify no callers remain.

---

## Priority Tier 5 — Consistency & Polish (low risk, incremental)

### 5.1 Standardize color usage

**Issue**: Some components use hardcoded hex (`#CC0000`), others use CSS variables (`var(--color-accent)`), others use Tailwind classes (`bg-cta`).
**Files affected**: `SearchBar.tsx`, `FeaturedCruises.tsx`, `PrioritiesSection.tsx`
**Fix**: Replace all hardcoded colors with CSS custom properties.

### 5.2 Extract magic numbers to named constants

**File**: `src/lib/fareharbor/client.ts`
**Examples**: `TokenBucket(30, 30)`, cache size `500`, TTL `300_000`
**Fix**: Extract to `const RATE_LIMIT_PER_SEC = 30`, `const CACHE_MAX_SIZE = 500`, etc.

### 5.3 Standardize API response wrappers

**Issue**: Some routes return `apiOk({ extras: data })`, others `apiOk(data ?? [])`, others `apiOk({ data })`.
**Fix**: Standardize to always wrap in a named key: `apiOk({ reviews: data })`.

### 5.4 Add metadata to pages missing it

**Pages without metadata**: `/account`, `/captain`, all `/admin/*` pages
**Fix**: Add `generateMetadata()` or static `metadata` export to each.

---

## Priority Tier 6 — Test Coverage (supports all refactoring)

### Current coverage

| Module | Tests | File |
|--------|-------|------|
| FareHarbor filters | 30 | `src/lib/fareharbor/filters.test.ts` |
| Extras pricing | 14 | `src/lib/extras/calculate.test.ts` |
| Formatting utils | 18 | `src/lib/utils.test.ts` |

### Recommended new tests (by refactoring priority)

| Module | Priority | What to test |
|--------|----------|------------|
| Google Reviews client | Tier 2 | `fetchGoogleReviews()`, `searchPlace()` — mock fetch |
| Google Reviews OAuth | Tier 2 | Token refresh, expiry check, auth URL generation |
| Booking create-intent | Tier 4 | Input validation, amount calculations |
| FareHarbor parsing | Tier 2 | `parseBoatName()`, `parseDurationMinutes()` after extraction |
| `ReviewCard` component | Tier 2 | Renders with/without photo, handles missing fields |
| `GuestCounter` component | Tier 2 | Min/max bounds, increment/decrement |
| Auth admin routes | Tier 1 | 403 for non-admin, 200 for admin |

---

## Implementation Order

```
Week 1:  Tier 1 (security) — add auth guards to all admin routes
Week 2:  Tier 2 (duplication) — extract shared components + utilities  
Week 3:  Tier 3 (splits) — BookingPanel and Navbar refactoring
Week 4:  Tier 4 (type safety) — fix casts, error handling, sunset migration
Ongoing: Tier 5 (polish) — color standardization, magic numbers, metadata
Ongoing: Tier 6 (tests) — add tests before and after each refactoring
```

Each tier is independent — completing one tier does not block starting another. All changes should be in separate PRs for easy review.

---

## Files Ranked by Refactoring Priority

| Rank | File | Reason | Tier |
|------|------|--------|------|
| 1 | All `/api/admin/*/route.ts` (12 files) | Missing auth guards | 1 |
| 2 | `ReviewsSection.tsx` + `CruiseReviews.tsx` | 95% duplication | 2 |
| 3 | `GuestSelectorPanel.tsx` + `DateStep.tsx` + `GuestStep.tsx` | Triple duplication | 2 |
| 4 | `BookingPanel.tsx` | 457 lines, mixed concerns | 3 |
| 5 | `src/lib/fareharbor/config.ts` + `sync.ts` | Duplicated parsing | 2 |
| 6 | `src/lib/fareharbor/sunset.ts` | 4× `as any`, missing migration | 4 |
| 7 | `src/lib/booking/create-intent.ts` | Unsafe cast, no validation | 4 |
| 8 | `Navbar.tsx` | 290 lines, could split | 3 |
| 9 | `SearchBar.tsx` | Hardcoded colors | 5 |
| 10 | `src/lib/fareharbor/client.ts` | Magic numbers | 5 |

---

## Risk Mitigation

- **Every refactoring PR must**: pass `npx tsc --noEmit`, pass `npm test`, deploy to Vercel preview
- **No behavior changes** — refactoring only moves code, extracts components, adds types
- **Feature flags not needed** — all changes are internal structural improvements
- **Rollback plan** — each PR is small enough to revert independently
- **Before extracting**: write tests for existing behavior. After extracting: verify tests still pass.

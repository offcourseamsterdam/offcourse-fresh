# Refactoring Plan — FareHarbor + Listing Layer

**Created:** 2026-05-06
**Scope:** `src/lib/fareharbor/*` and its callers
**Status:** Plan — ready for review, not yet executed

## Context

The FareHarbor + listing layer (`src/lib/fareharbor/*` and its callers) is the engine behind every public availability lookup, every admin booking action, and every sync from FareHarbor into Supabase. It works today, with solid test coverage on the 3-layer filter system and a single rate-limited HTTP client. But growth has produced two classes of debt:

1. **Duplication and leakage** — boat-name parsing exists in two files; resource→boat mapping is hardcoded in `availability.ts` and re-implemented inside `/api/admin/booking-flow/route.ts`; `Slot`/`Rate` types in admin components shadow the canonical FH types.
2. **Test and type holes around the orchestration boundary** — `client.ts`, `sync.ts`, `availability.ts` (the cutoff logic in particular), and `sunset.ts` have no direct unit tests. JSONB columns are typed as `Json`. `sunset.ts` carries five `as any` casts because the `sunset_times` migration was never created.

The intended outcome: a smaller, sharper FareHarbor module with one place for each concern, explicit types at every layer boundary, and tests that catch regressions before they hit the public booking flow. **Behavior must not change.**

---

## 1. High-level understanding

The layer is structured as:

- `client.ts` — singleton HTTP client. Token-bucket rate limiter (30 req/sec), 60s in-memory LRU cache, retry on 429, custom error hierarchy. Methods cover items, availabilities, two-step bookings (validate → create), rebook, cancel, note update.
- `types.ts` — hand-written FH API shapes + error classes.
- `config.ts` — boat constants + `buildTypeMapFromAvailabilities()` that parses customer_type names into `{ boat, duration, maxGuests }` via regex.
- `filters.ts` — pure 3-layer filter pipeline (resource PKs → customer-type PKs → time/date rules), zod schema for `availability_filters`, individually testable functions, `getSunsetTime` is mocked in tests.
- `availability.ts` — orchestrator: `getFilteredAvailability(listingId, date, guests)` is the public entrypoint. Loads listing + FH item from Supabase, calls client, builds typeMap, applies filters, transforms to `AvailabilitySlot[]`, applies booking cutoff (with shared-cruise exception).
- `sunset.ts` — sunrise-sunset.org fetch with intended Supabase `sunset_times` cache (table missing → `as any`).
- `sync.ts` — pulls FH items, derives `item_type`, scrapes one availability detail to extract resources + customer types, upserts JSONB onto `fareharbor_items`. Re-implements boat/duration parsing locally.

External constraints: FareHarbor max 7 days per availability call, 30 req/sec / 3000 req/5min IP limits, two-step booking is mandatory, NET vs GROSS price distinction must be preserved (charge gross, never net), boat names "Diana" and "Curaçao" are domain identifiers.

Hot paths: every public search request and every cruise detail page render call `getFilteredAvailability()`. Every change here is in a hot path.

---

## 2. Main problems and code smells

| # | Issue | Where | Why it's a problem |
|---|---|---|---|
| P1 | Boat/duration parsing duplicated | `src/lib/fareharbor/config.ts` (`buildTypeMapFromAvailabilities`) and `src/lib/fareharbor/sync.ts` (`parseBoatName`, `parseDurationMinutes`, `getMaxGuests`) | Two regex parsers must stay in lockstep. Drift = silent corruption of typeMap or sync output. |
| P2 | Resource→boat mapping by name substring, replicated | `src/lib/fareharbor/availability.ts` (~line 47) and `src/app/api/admin/booking-flow/route.ts` | Hardcoded heuristic ("name includes 'diana'") in two places. New boat = bug in two files. |
| P3 | Filter pipeline reimplemented in admin | `src/app/api/admin/booking-flow/route.ts` (lines ~33–67) replicates `getFilteredAvailability()` logic instead of calling it | Two implementations of the same business rule. Bug fix in one will not propagate. |
| P4 | `availability.ts` mixes 4 concerns in one function | `getFilteredAvailability()` does Supabase load, FH fetch, typeMap build, filter, transform, cutoff | Hard to unit test the cutoff/shared-cruise rule in isolation. Currently has zero direct tests. |
| P5 | `as any` casts in sunset module | `src/lib/fareharbor/sunset.ts` (≥5 locations) | `sunset_times` migration was never landed. Type system is silenced. Cache silently no-ops in prod. |
| P6 | Confusing dual base URLs | `client.ts` uses `FAREHARBOR_API_BASE` (internal v1) and a hardcoded `EXTERNAL_API_BASE` (external v1) for `getBookings()` | Two URLs both labeled "v1". A future maintainer will route to the wrong one. |
| P7 | JSONB columns typed as `Json` | `fareharbor_items.resources` and `fareharbor_items.customer_types` in `src/lib/supabase/types.ts` | No shape enforcement on read. Sync writes one shape; readers assume it. Schema drift goes undetected. |
| P8 | Type duplication for FH shapes | `src/components/admin/fareharbor/types.ts` (`Slot`, `Rate`) duplicates `FHMinimalAvailability`/`FHCustomerTypeRate` | Two definitions of the same wire shape. They will diverge. |
| P9 | Test coverage gaps on hot paths and boundaries | No direct tests for: `client.ts` (rate limiter, cache, retry, all CRUD), `availability.ts` (orchestration + `applyCutoff` shared-cruise exception), `sync.ts`, `sunset.ts` | Regressions in the most consequential code go unnoticed. |
| P10 | Dead code still imported | `getCustomerTypeMap()` in `config.ts` is deprecated (returns empty Map) but still imported by `src/app/api/admin/fareharbor-test/route.ts` | Misleads readers; encourages reuse of a no-op. |
| P11 | Unreachable branch in time-rules layer | `src/lib/fareharbor/filters.ts` `applyTimeAndDateRules` `max_guests_override` block has a logically unreachable post-filter check | Reader noise; a future edit may "fix" it incorrectly. |
| P12 | Shallow `cloneAvailability` | `src/lib/fareharbor/filters.ts` clones rates but shares nested `customer_type` objects | Works today only because callers don't mutate. Fragile invariant; one mutation away from cross-listing pollution. |
| P13 | No env validation at startup | `client.ts` constructor warns and continues with empty strings if `FAREHARBOR_API_APP/USER` missing | Failures deferred to first API call, often inside a request. Should fail loud at boot. |

---

## 3. Refactoring goals

Each goal traces to the smells above:

- **G1 — One source of truth per concept.** Single boat parser, single resource→boat map, single filter pipeline call site for admin and public flows. (Resolves P1, P2, P3.)
- **G2 — Test the orchestration seam.** Add unit tests for `getFilteredAvailability`, `applyCutoff`, `client.ts` retry/cache/rate-limit, `sync.ts`, `sunset.ts`. (Resolves P4, P9.)
- **G3 — Close the type holes.** Zod schemas at every JSONB read site; explicit input/output types per filter layer; drop duplicate component-level FH types. (Resolves P7, P8, and tightens P11/P12.)
- **G4 — Honour the sunset cache.** Land the migration, remove `as any`, test the path. (Resolves P5.)
- **G5 — Make config and dead code unambiguous.** Validate env once, name the two FH API surfaces clearly, delete `getCustomerTypeMap()`. (Resolves P6, P10, P13.)
- **G6 — Keep `availability.ts` composable.** Split the orchestrator into named, testable steps without changing its public signature. (Resolves P4.)

External behavior (every public API response, every booking outcome, every sync result) stays identical.

---

## 4. Phased refactoring plan

### Phase 1 — Safe / mechanical clean-ups

Each step here is local and reversible. No public signatures change.

1. **Delete `getCustomerTypeMap()` and its caller path.**
   - Remove the deprecated export from `src/lib/fareharbor/config.ts`.
   - Remove the import and any reference in `src/app/api/admin/fareharbor-test/route.ts`.
   - Verify with grep that no other file imports it.

2. **Remove the unreachable `max_guests_override` post-check** in `applyTimeAndDateRules` in `src/lib/fareharbor/filters.ts`. Keep the early-return form. Re-run `filters.test.ts` — already 30+ cases cover this.

3. **Rename FH API base constants for clarity** in `src/lib/fareharbor/client.ts`:
   - `FAREHARBOR_API_BASE` → `FAREHARBOR_INTERNAL_API_BASE` (internal v1).
   - `EXTERNAL_API_BASE` → `FAREHARBOR_EXTERNAL_API_BASE` (external v1).
   - Add a one-line comment at each declaration explaining which endpoint family uses which.
   - The public env var stays `FAREHARBOR_API_BASE` for backwards compat; rename the internal symbol only.

4. **Tighten loose annotations where it costs nothing.**
   - Add explicit return types to filter helpers and `transformToSlot` in `src/lib/fareharbor/availability.ts` and `filters.ts`.
   - Replace `Record<string, unknown>` casts in `sync.ts` with a small local interface for the FH item fields actually read.

5. **Promote inline magic strings to named constants** in `client.ts`: `COMPANY = 'offcourse'`, `MAX_RETRIES = 3`, rate-limiter constants — already partially done; finish the pass and group at the top of the file.

### Phase 2 — Structural and modular improvements

The bulk of the value lives here. Every step is localized to the FareHarbor layer; no consumer imports break.

6. **Extract shared parsing helpers.** Create `src/lib/fareharbor/parsing.ts` (or expand `config.ts`) and move `parseBoatName`, `parseDurationMinutes`, `getMaxGuests` there. Have both `config.ts` and `sync.ts` import from this single source. (Resolves P1.)

7. **Centralize resource→boat mapping.** Add `buildResourcePkToBoatMap(item: FareHarborItemRow): Map<number, BoatId>` in `src/lib/fareharbor/config.ts`. Replace the inline mapping in `src/lib/fareharbor/availability.ts` and the duplicate in `src/app/api/admin/booking-flow/route.ts` with calls to this helper. (Resolves P2.)

8. **Collapse the admin filter duplication.** Refactor `src/app/api/admin/booking-flow/route.ts` to call `getFilteredAvailability()` per listing/item, or — if the admin endpoint legitimately needs more raw data — extract a new `getFilteredAvailabilityForItem(itemPk, date, guests, listingConfig)` helper in `availability.ts` that both the admin route and the public flow use. (Resolves P3.)

9. **Split `getFilteredAvailability()` into named steps** in `src/lib/fareharbor/availability.ts`, keeping the public function as a thin composition:
   - `loadListingFilterConfig(listingId)`
   - `loadFareHarborItem(itemPk)`
   - `fetchRawAvailabilities(itemPk, date)` (already present as `getRawAvailabilities`)
   - `applyListingFilters(...)` (already present)
   - `transformSlots(typeMap, availabilities)`
   - `applyCutoff(slots, item, listing, now)`
   The public signature and return type of `getFilteredAvailability()` are unchanged. (Resolves P4.)

10. **Validate JSONB at the read boundary.** Define zod schemas for `fareharbor_items.resources` and `fareharbor_items.customer_types` in `src/lib/fareharbor/types.ts`. Parse with these schemas everywhere the columns are read (`availability.ts`, `api/admin/booking-flow/route.ts`, admin settings page). On parse failure, log and degrade rather than crash. (Resolves P7.)

11. **Drop duplicate component types.** Delete `Slot` and `Rate` from `src/components/admin/fareharbor/types.ts`; import `FHMinimalAvailability` and `FHCustomerTypeRate` from `src/lib/fareharbor/types.ts` instead. Update consuming admin components. (Resolves P8.)

12. **Land the `sunset_times` migration and remove `as any`.** Create `supabase/migrations/NNN_sunset_times.sql` with `(date, city, sunset_time, sunrise_time, fetched_at)` per the existing schema in `sunset.ts`. Regenerate `src/lib/supabase/types.ts`. Remove all `as any` casts in `src/lib/fareharbor/sunset.ts`. (Resolves P5.)

13. **Centralize FH env access.** Create `src/lib/fareharbor/env.ts` that reads and validates `FAREHARBOR_API_APP`, `FAREHARBOR_API_USER`, `FAREHARBOR_API_BASE` once. Throw at import time if any are missing in production (`process.env.NODE_ENV === 'production'`). `client.ts` consumes from this module instead of `process.env` directly. (Resolves P13.)

### Phase 3 — Deeper design and architecture improvements

Higher risk; only after Phase 2 has shipped and stabilized.

14. **Make the filter chain truly immutable.** Replace the shallow `cloneAvailability` in `src/lib/fareharbor/filters.ts` with a structured deep clone (`structuredClone`) for the rate array path, or convert filter functions to return new shapes built from scratch rather than cloning + mutating. (Resolves P12.)

15. **Explicit per-layer types.** Define `ResourceFilterInput`, `CustomerTypeFilterInput`, `TimeRulesFilterInput`, and matching outputs in `src/lib/fareharbor/filters.ts`. Each filter function gets a precise contract instead of taking the full availability object. Public `applyAllFilters` signature unchanged. (Strengthens P11/P8.)

16. **Move boat identity out of regex and into data.** Once `fareharbor_items.resources[].boat` and `customer_types[].boat` are populated by sync (already are), refactor `buildResourcePkToBoatMap` and `buildTypeMapFromAvailabilities` to read the stored `boat` field instead of re-parsing the name. Keep regex as a fallback only when the field is missing. (Hardens P1/P2.)

17. **Introduce a service-layer interface for the FH client.** Define `interface FareHarborService { getAvailabilities(...); validateBooking(...); ... }` in `src/lib/fareharbor/types.ts`. `getFareHarborClient()` returns this interface. Tests can pass a fake. Reduces singleton coupling for new tests in Phase 2. (Enables P9 testability.)

18. **Request-scoped memoization for typeMap and resource map** in `src/app/api/admin/booking-flow/route.ts`. The admin endpoint fans out across listings; cache derived maps for the lifetime of the request. Pure perf, no behavior change.

---

## 5. Impact and risk per step

| Step | Impact | Risk | Watch out for |
|---|---|---|---|
| 1 — delete deprecated map | Less reader confusion | Low | grep proves no other consumer |
| 2 — unreachable branch | Cleaner control flow | Low | Re-run all `filters.test.ts` cases |
| 3 — rename internal constants | Clearer reading | Low | Don't rename the env var, only the symbol |
| 4 — explicit return types | Catches future drift | Low | Some `unknown` may need to remain |
| 5 — magic-string constants | Cosmetic | Low | None |
| 6 — shared parsing module | Removes a class of drift bugs | Low–Med | Both call sites currently agree; ensure the consolidated regex matches both |
| 7 — central resource→boat map | Single bug-fix surface | Med | Admin route and public route must produce identical maps; snapshot-test the map |
| 8 — collapse admin filter dup | Big readability + correctness win | **Med–High** | Admin path may rely on subtle differences (no cutoff, different guest semantics). Diff outputs before/after on real data |
| 9 — split orchestrator | Unlocks unit tests | Low–Med | Public signature must stay identical; integration test on `getFilteredAvailability` end-to-end |
| 10 — zod at JSONB boundary | Surfaces real schema drift | Med | First deploy may log unexpected validation errors — that's signal, not noise |
| 11 — drop duplicate types | Prevents divergence | Low | Update all admin component imports |
| 12 — sunset migration | Real cache, real types | Med | Migration must be idempotent; deploy with revalidation in mind |
| 13 — env validation | Loud failure at boot | Low–Med | Don't break local dev when keys are intentionally absent — gate on NODE_ENV |
| 14 — deep clone | Safer filter chain | Med | `structuredClone` is fine in Node 18+; profile on hot path before/after |
| 15 — explicit layer types | Tighter contracts | Low | Public `applyAllFilters` shape must not change |
| 16 — boat identity from data | Removes regex fragility | Med | Need a fallback for legacy items; sync must have run at least once |
| 17 — service interface | Enables fakes in tests | Low–Med | Don't change runtime behavior of singleton |
| 18 — admin memoization | Perf only | Low | Don't memoize across requests by accident |

---

## 6. Testing and validation strategy

### Existing safety net (preserve and grow)

- `src/lib/fareharbor/filters.test.ts` (30+ cases) — keep green at every step.
- `src/lib/fareharbor/config.test.ts` (10 cases) — keep green.
- `src/lib/booking/create-intent.test.ts` (7 cases) — keep green; this is the only existing FH-client integration test.
- `src/lib/extras/calculate.test.ts` and `src/lib/utils.test.ts` — unrelated but part of the suite that runs.

### New tests to add (in order)

Add **before** the structural changes that touch each module:

1. **`src/lib/fareharbor/client.test.ts`** — mock `fetch`. Cover:
   - Auth headers attached on every request.
   - 60s LRU cache hit on repeat GETs.
   - 429 retry with exponential backoff (1s, 2s, 4s) up to 3 attempts.
   - Token-bucket throttle: 31 concurrent requests serialize correctly.
   - Error mapping (401 → `FHAuthError`, 404 → `FHNotFoundError`, etc.).
2. **`src/lib/fareharbor/availability.test.ts`** — mock the client, mock Supabase. Cover:
   - `applyCutoff` shared-cruise exception (capacity < max → keep bookable).
   - `applyCutoff` `callToBook` flag set when cutoff passed and no prior booking.
   - `transformToSlot` for non-capacity fields (start/end times, duration, customer types).
3. **`src/lib/fareharbor/sync.test.ts`** — mock the client. Cover:
   - `item_type` derivation from name (`'shared'` substring).
   - Resources/customer_types JSONB extraction from the first availability detail.
   - Idempotent upsert (calling twice with same data produces same row).
4. **`src/lib/fareharbor/sunset.test.ts`** — mock `fetch` and Supabase. Cover:
   - Cache hit returns without HTTP.
   - Cache miss fetches, parses, upserts.
   - Network failure returns null (graceful degradation).
   - Pre-seed loops over N days correctly.

### Per-phase validation checklist

Run after each phase before merging:

- [ ] `npm test` — all suites green.
- [ ] `npx tsc --noEmit` — no new type errors.
- [ ] `npm run lint` (if configured).
- [ ] Manual smoke: open `/`, search for a date with availability, click a result, confirm timeslots render. Open `/cruises/{slug}`, confirm same. Open admin booking flow, confirm slot list matches the public flow for the same date/guests.
- [ ] After Phase 2 step 8 (admin/public unification): pick three real listings, run `getFilteredAvailability` and the admin endpoint side-by-side for the same date+guests, diff the slot arrays. Must be identical (modulo admin-only fields).
- [ ] After Phase 2 step 12 (sunset migration): hit a listing whose `availability_filters` uses `sunset_offset_minutes`, confirm slots filter correctly and `sunset_times` row appears in Supabase.

---

## 7. Execution order and practical tips

### Recommended order

1. Phase 1 in one PR (steps 1–5). Mechanical, fast review.
2. **Add tests first** for `client.ts`, `availability.ts`, `sync.ts`, `sunset.ts` — one PR per module — *before* their structural refactor. This is the rule from CLAUDE.md ("If a refactoring touches code that doesn't have tests yet, write tests FIRST, then refactor").
3. Phase 2 step 12 (sunset migration) early — unblocks type cleanup elsewhere and is a precondition for sunset tests.
4. Phase 2 steps 6, 7, 11 (extractions and dedup) in small PRs.
5. Phase 2 step 9 (split orchestrator) — only after `availability.test.ts` exists.
6. Phase 2 step 8 (collapse admin duplication) — last in Phase 2; needs the centralized helpers from step 7 and the orchestrator split from step 9.
7. Phase 2 steps 10, 13 — independent, can land any time.
8. Stop and ship. Validate in production for at least one full day.
9. Phase 3 steps 14–18 — only after Phase 2 has been live and stable.

### Practical tips

- **One concern per PR.** This module is in every hot path; tiny PRs make bisects easy.
- **Snapshot the public API output** of `/api/search` for a known date+listing+guest combo before Phase 2 step 8, and assert the post-refactor output is byte-identical.
- **Branch naming**: keep work on `claude/refactoring-plan-template-Wn1Tw` for the plan itself; spin off feature branches per phase for the implementation work, e.g. `refactor/fh-phase-1-cleanup`, `refactor/fh-extract-parsing`, `refactor/fh-sunset-migration`.
- **Commit messages**: name the smell being fixed (e.g. "Extract shared FH parsing helpers (resolves P1)") so the plan and the history line up.
- **Don't skip the test-first rule.** Steps 6, 8, 9 in particular must not land without their tests, because they touch the function called on every public render.

### Critical files (modification surface)

- `src/lib/fareharbor/client.ts`
- `src/lib/fareharbor/types.ts`
- `src/lib/fareharbor/config.ts`
- `src/lib/fareharbor/filters.ts`
- `src/lib/fareharbor/availability.ts`
- `src/lib/fareharbor/sunset.ts`
- `src/lib/fareharbor/sync.ts`
- `src/lib/fareharbor/parsing.ts` *(new)*
- `src/lib/fareharbor/env.ts` *(new)*
- `src/app/api/admin/booking-flow/route.ts`
- `src/app/api/admin/fareharbor-test/route.ts`
- `src/components/admin/fareharbor/types.ts`
- `supabase/migrations/NNN_sunset_times.sql` *(new)*
- `src/lib/supabase/types.ts` *(regenerated after migration)*

### Existing helpers/utilities to reuse

- `applyAllFilters` (`src/lib/fareharbor/filters.ts`) — keep as the single filter entrypoint; admin flow should call this, not re-implement it.
- `applyListingFilters` (`src/lib/fareharbor/availability.ts`) — already a reusable wrapper; widen its use.
- `buildTypeMapFromAvailabilities` (`src/lib/fareharbor/config.ts`) — already deduplicates customer types; merge sync's parsing into it rather than the other way round.
- `getFareHarborClient()` — single chokepoint for HTTP; do not introduce parallel clients.
- `AvailabilityFiltersSchema` (`src/lib/fareharbor/filters.ts`) — pattern to copy for new JSONB schemas in step 10.

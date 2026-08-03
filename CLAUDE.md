# Off Course Amsterdam — Next.js Rebuild

## Project Overview

Off Course Amsterdam is "your friend with a boat" — an electric boat company in Amsterdam offering private and shared canal cruises through the city's hidden gems. Not a tour company, not luxury — the sweet spot between taste and zero pretension. This is a full rebuild from Lovable (React) to Next.js, with a search-first booking flow, native Stripe checkout, and an admin backend.

**Stack:** Next.js 16 (App Router; webpack dev server) · TypeScript · Tailwind CSS v4 · Supabase · Stripe · FareHarbor External API v1 · Claude Sonnet (text AI) · Google Gemini (vision AI) · Vercel

## Key Architecture Concepts

### Virtual Product Layer (CRITICAL — read before any booking/listing work)
The site uses a "virtual product" architecture where multiple cruise listings map to the same FareHarbor item. This means:
- `fareharbor_items` = synced from FareHarbor API (few items, shared availability pool)
- `fareharbor_resources` = boats (Diana, Curaçao) with their FH PKs
- `fareharbor_customer_types` = boat+duration combos (Diana 1.5h, Diana 2h, etc.) with their FH PKs
- `cruise_listings` = unlimited virtual products, each linked to one FH item
- Each listing has its own photos, descriptions, SEO, and a **3-layer filter system**

### 3-Layer Availability Filter System
Every listing filters FareHarbor availability data through 3 layers:
1. **Resource filter** (`allowed_resource_pks`) — which boats are shown
2. **Customer type filter** (`allowed_customer_type_pks`) — which durations are available
3. **Time/date rules** (`availability_filters` JSON) — time-of-day, sunset, seasonal, day-of-week

All 3 layers are applied sequentially in `src/lib/fareharbor/filters.ts`.

### FareHarbor API
- Company shortname: `offcourse`
- Auth: `X-FareHarbor-API-App` + `X-FareHarbor-API-User` headers on every request
- Always use the **minimal** availability endpoint for date browsing
- Resource capacity = 1 per boat. `capacity >= 1` = available, `< 1` = booked
- Max 7 days per availability request. Batch for calendar views.
- Rate limits: 30 req/sec, 3000 req/5min per IP
- Two-step booking: validate first, then create. Never skip validation.
- Full API docs: see `docs/fareharbor-api.md`

### Public Booking Flow (CRITICAL — the main user journey)
Two entry points, one flow:

**Entry 1 — Homepage search (primary):**
1. Homepage hero has a **search bar**: date picker + guest count + "Search" button
2. User picks date & number of guests → clicks Search
3. Results section appears below with all matching cruise listings for that date
4. Each result card shows: photo, cruise name, departure times, duration, starting price
5. User clicks a result → goes to that cruise's detail page with date/guests pre-filled
6. On detail page: select timeslot → select duration (private) → checkout

**Entry 2 — Direct cruise page landing (SEO/ads/links):**
1. User lands directly on `/cruises/{slug}` (from Google, ad, Instagram, etc.)
2. Sees cruise detail page with its own date picker + guest count
3. Same flow from there: pick date → pick guests → see timeslots → checkout

**Key UX principles:**
- Search availability first, then show what's available — never make users browse blindly
- Results are filtered through the 3-layer system (boats, durations, time rules per listing)
- Private listings show boat cards + duration selector; shared listings show per-person pricing
- The whole flow uses FareHarbor API data filtered through the virtual product layer

### Manual Bookings from External Platforms (GetYourGuide, TripAdvisor, etc.)

When entering a booking that came in via an external platform (GYG, TripAdvisor, Withlocals, etc.):

1. **Check FareHarbor availability first** — use the `/api/external/v1/companies/offcourse/items/{fh_pk}/minimal/availabilities/date/{date}/` endpoint
2. **Get the full availability** to find the correct `customerTypeRatePk` — use `/api/external/v1/companies/offcourse/availabilities/{availPk}/`
3. **Add extras on our side** — the external platform's extras (e.g. "Unlimited Drinks Package" on GYG) are NOT automatically synced. Look up the matching extra in our `extras` table and include it in `extrasSelected` in the booking payload. Never just put extras in the note.
4. **Use `bookingSource: 'getyourguide'`** (or the relevant platform slug) — this marks it as internal, skips Stripe, and auto-attributes the booking to the right campaign
5. **Confirm with Beer before submitting** — show the full booking summary including extras and ask for approval
6. **Deposit amount** = what the platform paid us (shown on their booking confirmation email)

To get cruise duration and departure location, always read from the `cruise_listings` table:
- `duration_display` — human-readable duration (e.g. "1 hour & 30 minutes")
- `departure_location` — exact departure address to include in confirmations
- `max_guests` — capacity cap

Key extras IDs:
- Unlimited Drinks: `9fc55b42-14ea-4230-b8e2-d83434de2e54` (€10/person/hour, 21% VAT — multiply by guests × hours)
- Bring Your Own Drinks: `2baeeb95-4d6f-40d7-98b3-62f15524972a` (€5/person, 21% VAT)
- Bites Box Small (1-2p): `8cacd3a0-c64f-491b-ba31-d5eea3ddf5a4` (€20 fixed, 9% VAT)
- Bites Box Medium (3-4p): `5dd45eea-134e-4b0f-ba2b-440896b342b3` (€35 fixed, 9% VAT)
- Bites Box Large (6p): `a8a6adf0-6571-49e4-adf6-663d5d91e503` (€65 fixed, 9% VAT)

### Stripe Native Checkout
Using Payment Intents (NOT Checkout Sessions) for Google Ads conversion tracking control.
- PaymentIntent amounts in cents (€165 = 16500)
- Store booking metadata on PaymentIntent
- Webhook verifies payment → confirms FareHarbor booking → updates Supabase

### AI Stack
- **Claude Sonnet** (Anthropic API): all text — translations, blog writing, content generation
- **Google Gemini**: all vision — image analysis, labeling, scene detection, SEO filenames
- Both use the company context from `src/lib/ai/context.ts`
- Translations: admin writes English → AI generates 6 other languages automatically

### Google Ads (conversion tracking + campaign management)
Two server-side subsystems in `src/lib/google-ads/`, sharing one OAuth (`auth.ts`):
- **Conversion tracking** — the Stripe webhook reports each paid booking to Google as an Offline Conversion at its **net ex-VAT value** (never the gross total). See `report-conversion.ts` + `conversion-value.ts`.
- **Campaign management** — create/read/control Search campaigns from code via the CLI: `npm run gads -- <command>` (`accounts`, `campaigns`, `create`, `performance`, `pause`/`enable`, `add-negatives`…). Campaigns are defined as JSON in `scripts/google-ads/campaigns/`. `create` is **dry-run by default** (Google `validateOnly`); needs `--live`, and new campaigns start **PAUSED**.
- Full docs: `docs/features/google-ads-conversion-tracking.md` and `docs/features/google-ads-campaign-management.md`.

### i18n
7 locales: `en` (default), `nl`, `de`, `fr`, `es`, `pt`, `zh`
All content tables have `_nl`, `_de`, `_fr`, `_es`, `_pt`, `_zh` columns.
Static UI strings in `/src/lib/i18n/messages/{locale}.json` (AI-generated, committed).

## Reference Docs

Before starting work on any track, READ the relevant docs:
- **Full implementation plan:** `docs/implementation-plan.md`
- **FareHarbor API reference:** `docs/fareharbor-api.md`
- **Booking flow PRD:** `docs/prd-booking-flow.md`
- **Track instructions:** `docs/tracks/track-{letter}.md`
- **Active security & cleanup plan:** `docs/security-and-cleanup-plan.md` — phased fixes from the
  2026-07 sitewide review (RLS/auth hardening, money-path tests, structural cleanup). Check before
  starting booking/finance/admin work to avoid duplicating or conflicting with in-progress fixes.

## Development Phases

### Phase 1 — MVP (Public Website + Booking + Payments)
- Track A: Core setup + infra (do FIRST)
- Track B: Public pages (after A)
- Track C: FareHarbor + listing layer (after A, parallel with B)
- Track D: Stripe + checkout (after C)

### Phase 2 — Admin Backend + Operations
- Track E: Admin shell + auth (do FIRST)
- Track F: Operations (after E)
- Track G: Content + listing management (after E, parallel with F)

### Phase 3 — Slack, AI, SEO, Dev Tools
- Track H: Slack integration (independent)
- Track I: AI + SEO tools (independent)
- Track J: Dev tools (independent)

## How to Communicate with Beer (Project Owner)

Beer is a vibe coder — not a traditional developer, but someone who wants to deeply understand the workings of their own app. When making changes or explaining decisions:

1. **Always explain WHY in non-coder terms** — use metaphors, real-world analogies. Beer learns through understanding the "why", not the syntax.
2. **Teach architecture concepts step by step** — when a code change reflects a broader principle (DRY, separation of concerns, hot paths), name the principle and explain it in plain English.
3. **Connect changes to the business** — "this makes your site load faster for visitors" matters more than "this reduces O(n) to O(1)".
4. **Build on previous explanations** — reference earlier concepts Beer has learned (the librarian metaphor for dev server caching, etc.) to create a growing mental model.
5. **Never assume Beer knows jargon** — if you use a term like "hot path" or "N+1", define it immediately.

Beer's goal: become someone who can read their own codebase, understand architectural decisions, and spot when something smells off — even without writing code line by line.

## Known Gotchas

### Dev Server
Two ways to run the app — pick whichever fits the task:

**Option A — Beer's own Terminal (default for long sessions):**
1. Beer runs `npm run dev` from his own Terminal.app
2. Claude Code edits code and reads files as normal
3. For visual verification, use Claude in Chrome MCP tools to browse `http://localhost:3000`

**Option B — Claude Code preview server (try this first for verification):**
- The previous Turbopack + macOS sandbox crash appears to be resolved.
- `preview_start` is allowed again — use it when verifying UI changes via the `<verification_workflow>`.
- If the dev server crashes mid-session, fall back to Option A and note it so we can re-disable preview.

Do NOT spawn `next dev` directly from Bash — use `preview_start` if you want Claude Code to run the server.

### Turbopack Cache MUST Stay Disabled (CRITICAL)
`next.config.ts` has `experimental: { turbopackFileSystemCacheForDev: false }`. **NEVER remove this.**

**Why:** Turbopack uses RocksDB for persistent caching. RocksDB only allows one write at a time. This project (21 pages × 7 locales) generates enough concurrent compilation to overwhelm RocksDB's single-writer lock. When writes collide, `.next/dev/build/postcss.js` fails to persist, PostCSS workers crash, `globals.css` can't compile, and the entire dev server dies.

**`npm run dev` uses `--webpack` by default** (`rm -rf .next && next dev --webpack`) and auto-cleans `.next` on startup to avoid corrupted cache from previous sessions. `npm run dev:turbo` opts into Turbopack — and the crash risk above. Keep both the `rm -rf .next` and the `--webpack`.

**Trade-off:** Cold starts are slightly slower (no cache to restore). But the server won't crash mid-session.

### proxy.ts vs middleware.ts (CRITICAL)
Next.js 16 renamed middleware → proxy. This project uses `src/proxy.ts` ONLY.
**NEVER create `src/middleware.ts`** — the build will fail if both exist.
If you need to modify request handling (auth, i18n, redirects), edit `src/proxy.ts`.

### Testing Stripe Locally Without Live Keys
`.env.local` holds LIVE Stripe keys by default. To test payment flows against Stripe's real
TEST-mode API (not just mocks) without ever touching `.env.local`, pass test keys as one-off
env vars to the command itself:
```bash
STRIPE_MODE=test STRIPE_SECRET_KEY_TEST=sk_test_... npx vitest run src/lib/booking/stripe-integration.test.ts
```
`src/lib/stripe/keys.ts` resolves `sk_test_`/`pk_test_` keys automatically when `STRIPE_MODE=test`
is set — this is the ONLY way to verify a payment-flow change against real Stripe behavior instead
of mocks. Never paste test (or worse, live) keys into `.env.local` just to run this once.

### Supabase Schema Changes: Regenerate Types or Get Cryptic Errors
After ANY migration that adds/changes a column, regenerating `src/lib/supabase/types.ts` (command
in the Supabase section above) is not optional — skip it and `tsc` won't say "column missing," it
will say `SelectQueryError<"column 'x' does not exist on 'table'.">` on every unrelated line that
touches that row, which reads like a different bug entirely.

### New Supabase Tables: RLS Is NOT Automatic
Creating a table does not enable Row Level Security — it must be turned on explicitly
(`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) in the same migration, plus a policy if the table
needs any access at all (anon SELECT for public content, none for anything else — writes go
through service-role API routes per the rule below). A 2026-07 audit found 21 tables had shipped
with RLS silently off since creation. Nothing currently checks for this automatically — verify
manually before shipping any migration that adds a table.

### New Admin Route Export Shapes Need `admin-route-contract.test.ts` Updated Too
`src/lib/auth/admin-route-contract.test.ts` enforces every `/api/admin/**` handler has
`requireAdmin()` by regex-scanning each route file for its exported HTTP methods. Its
`findHandlers()` only recognizes the shapes it's been taught: plain `export async function GET(...)`,
`export const GET = withRoute(...)`, and `export const { GET } = createSummaryRoute(...)`. Introducing
a new route-wrapper/factory pattern with a different export shape (this has happened 3 times
already — `withRoute()`, then `createSummaryRoute()`) makes the guardrail **silently skip** those
routes rather than fail — it reports zero unguarded handlers because it found zero handlers at all,
which reads as "all clear" when it's actually blind. Whenever you add a new way of exporting a route
handler, add a matching pattern to `findHandlers()` in the same change, and re-run the contract test
file alone to confirm it now actually iterates the new routes instead of finding none.

## How to Work

1. Always read the track instruction file before starting: `docs/tracks/track-{letter}.md`
2. Complete one track at a time, in order within each phase
3. After completing a track, run the verification checklist at the bottom of the track file
4. Commit with clear messages per feature/component
5. Never expose API keys client-side — all external API calls go through Next.js API routes

## Testing (MANDATORY for new features and refactoring)

**Every new feature or design change must include tests.** This is how we keep the site from breaking when things change.

**Stack:** Vitest (configured in `vitest.config.ts`)
**Run:** `npm test` (all tests) · `npm run test:watch` (live reload while developing)

### Rules
1. **New business logic** — write unit tests for any calculation, filter, or data transformation. See `src/lib/extras/calculate.test.ts` and `src/lib/fareharbor/filters.test.ts` for examples.
2. **New utility functions** — test edge cases (empty input, null, zero, boundary values). See `src/lib/utils.test.ts`.
3. **Refactoring** — run `npm test` before and after. Tests must pass both times. If a refactoring touches code that doesn't have tests yet, write tests FIRST, then refactor.
4. **Test files** live next to the code they test: `calculate.ts` → `calculate.test.ts`
5. **Keep tests fast** — mock external services (Supabase, FareHarbor API, Stripe). See how `filters.test.ts` mocks the sunset API.
6. **What NOT to test** — don't test React component rendering or Tailwind classes. Test the logic, not the UI.

### Current Test Coverage
Run `npm test` for the live count (currently **1215 tests across 120 files**, plus 6 opt-in
integration tests that self-skip unless real Stripe test keys are supplied). Key areas:
- FareHarbor 3-layer filters — `src/lib/fareharbor/filters.test.ts`
- Extras pricing / VAT math — `src/lib/extras/calculate.test.ts`
- Formatting utilities — `src/lib/utils.test.ts`
- Google Ads (conversion value, campaign builders, reporting, transport) — `src/lib/google-ads/*.test.ts`
- Stripe webhook — `src/app/api/webhooks/stripe/route.test.ts`
- Booking money-path (quote/discount, PaymentIntent creation, `/book` payment gate, the
  `pending-fh-sweep` recovery cron) — `src/lib/booking/calculate-quote.test.ts`,
  `src/app/api/admin/booking-flow/book/route.post.test.ts`,
  `src/app/api/cron/pending-fh-sweep/route.test.ts`
- Real Stripe test-mode integration (opt-in, hits the actual Stripe test API — see Gotchas below) —
  `src/lib/booking/stripe-integration.test.ts`

## Responsive Design (MANDATORY)

**Every component, page, and UI element must be fully responsive.** This is non-negotiable.

### Breakpoints (Tailwind defaults)
- `sm` = 640px — most layout switches happen here (stack → side-by-side)
- `md` = 768px — medium adjustments (font sizes, spacing)
- `lg` = 1024px — desktop-optimised layouts
- `xl` / `2xl` — wide screen polish

### Rules
1. **Mobile-first always** — write base styles for mobile, override upward with `sm:`, `md:`, `lg:`
2. **No fixed pixel widths** on containers — use `max-w-*` + `w-full` so they shrink naturally
3. **Touch targets** — any tappable element must be at least `44×44px` on mobile
4. **Dropdowns & panels** — on mobile, panels render inline (accordion/expand style); on desktop they float as absolute dropdowns
5. **Typography** — scale font sizes down one step on mobile: e.g. `text-4xl sm:text-6xl`
6. **Horizontal scroll** — never allow unintended horizontal overflow. Test with `overflow-hidden` on the root if needed
7. **Images** — always use `w-full h-auto` or Next.js `<Image>` with responsive sizing; never hard-coded pixel dimensions without `sm:` overrides
8. **Test at 375px (iPhone SE), 390px (iPhone 14), 768px (iPad), 1280px (desktop)** before considering any UI done

## Documentation Rule (MANDATORY)

**Before creating any pull request**, you must write a feature documentation file and commit it as part of the PR.

### Steps

1. Create `docs/features/{track-or-feature-name}.md` (e.g. `docs/features/track-b-public-pages.md`)
2. The file must cover:
   - **What was built** — a plain-English summary of the feature
   - **Key files** — list every new or significantly changed file with a one-line description
   - **Architecture decisions** — why things were built the way they were (non-obvious choices only)
   - **How it works** — data flow, key patterns, anything a new developer needs to understand
   - **How to extend** — how to add a new page / component / API route / etc. following the established pattern
   - **Dependencies** — what this feature depends on and what depends on it
3. Add an entry to `docs/features/README.md` (the documentation index) linking to the new file
4. Commit the docs file(s) together with the feature code, before opening the PR

### Format

Use clear headings, short paragraphs, and code snippets where helpful. Write for a developer joining the project mid-way — assume they know Next.js but not this codebase.

### Index file

`docs/features/README.md` is the master index. Keep it up to date. Format:

```
| Feature | File | Track | Status |
|---------|------|-------|--------|
| Core setup + infra | track-a-core-setup.md | A | done |
```

## Shadow AI / Ghost Rule (MANDATORY)

The Ghost is the shadow-mode AI layer (see `docs/plans/ai-operations-vision.md` §8-B2 and `/admin/ghost`). It reads the database (never the UI), drafts what it *would* do as rows in `agent_proposals` with status `'shadow'`, and never executes anything. Current kinds: `reply_draft` (per inbound chat message), `schedule_day` + `catering_order` (daily `/api/cron/ghost-ops`).

The Ghost is organized as **agents** (one per operation domain — registry in `src/lib/ghost/agents.ts`; inbox/booking/catering/scheduling active, maintenance/storage planned). Agentic runs use the Anthropic tool-use loop in `src/lib/ghost/agent-runtime.ts` with read-only tools from `src/lib/ghost/tools.ts`; the agent's terminal `submit_*` tool call IS the proposal (no JSON parsing).

### When adding ANY new operational feature or admin action, answer two questions:

1. **Can the Ghost shadow it?** If a human performs a recurring decision through the admin (assigning, ordering, replying, approving), give the matching agent a drafter: a new `kind` in `agent_proposals` owned by exactly one agent in `agents.ts`, a drafter (agentic via `runAgenticLoop` when it needs to look things up, single-call like `src/lib/ghost/ops-drafters.ts` when context is deterministic), and a card renderer in `/admin/ghost`. Always: read the truth from Postgres, payload + `reasoning`, status `'shadow'`, dedupe per target date, all errors swallowed. New read-only lookups become tools in `tools.ts` (compact results, descriptions that say WHEN to call).
2. **Is it a money/irreversible action?** Then it may get a Ghost *proposal* and a `dry_run` verdict, but NEVER auto-execution — refunds, FareHarbor bookings, payouts stay human-approved permanently.

Document the decision (even "not ghostable, because…") in the feature's `docs/features/*.md`.

### Autonomy ladder & execution (MANDATORY)

Per-kind autonomy lives in `src/lib/ghost/agents.ts`: `AUTONOMY_LEVEL` (current) ≤ `AUTONOMY_CEILING` (hard cap), levels `propose → dry_run → ask → auto`. `IRREVERSIBLE_KINDS` (booking, refunds, payouts) are pinned to a `dry_run` ceiling and a test in `agent-runtime.test.ts` fails CI if that's ever bumped.

- **Dry-run = execute reversibly.** To prove an agent "executes well" without permanent effect, use the system's no-side-effect check, not create-then-delete. For bookings that's `fh.validateBooking` (`src/lib/ghost/dry-run.ts`) — it never creates, emails, or holds capacity. Store the verdict in `payload.verdict`; status stays `'shadow'`.
- **Execution chokepoint.** Any future real action goes through one guarded handler (e.g. `/api/admin/ghost/dry-run` pattern), behind `requireAdmin`, that re-validates immediately before acting and refuses any kind above its ceiling. Agent tools stay read-only; the agent loop's only write is the shadow proposal.
- **The learning is data, not code.** The Ghost's memory lives in `ghost_knowledge` (+ `agent_proposals.outcome`), selected into prompts at runtime — NEVER in CLAUDE.md. Selection ladder: recency + `pinned` (now) → pgvector relevance (~40–60 facts) → distilled playbook (~100–150). Match the machinery to the data volume; don't build pgvector/playbook early.

### AI cost discipline (MANDATORY)

- **Every Claude/Gemini call MUST be metered** via `recordAiUsage()` from `src/lib/ai/usage.ts` (tokens → euro cents → `ai_usage` table). No exceptions — an unmetered call is invisible spend.
- Every €5 of cumulative spend automatically DMs Beer on Slack (`ai_usage_alerts` table guarantees exactly one alert per threshold). The Ghost page header shows total / 30-day spend.
- Drafters must be **skip-first**: no open shifts → no call; no catering bookings → no call; proposal already exists for the target date → no call. The cheapest AI call is the one not made.
- Keep `max_tokens` tight (≤1000 for drafters) and never put unbounded data in prompts — cap lists (e.g. last 30 messages, 5 bookings).

## Supabase

- Existing database with ~25 tables. Schema documented in `docs/implementation-plan.md` section 1.2
- Use RLS on all tables. Public tables get anon `SELECT`. Writes through API routes.
- **Project ID:** `fkylzllxvepmrtqxisrn`

### Running migrations (Claude Code has authority to do this directly)

Use the Supabase Management API — no CLI needed:

```bash
# Run a migration file
SQL=$(cat supabase/migrations/NNN_name.sql | sed 's/CREATE POLICY IF NOT EXISTS/CREATE POLICY/g')
curl -s -X POST "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo \"$SQL\" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

# Regenerate TypeScript types after migration
curl -s "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/types/typescript" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['types'])" > src/lib/supabase/types.ts
```

**Note:** `CREATE POLICY IF NOT EXISTS` is not supported — use `CREATE POLICY` (without IF NOT EXISTS) in migration files.

**Migrations 088–106 are already applied to prod.** They were run out-of-band via the Management
API (the normal workflow above) before being committed, so `git log` on `supabase/migrations/`
lags what's actually live. Do NOT replay this range against prod — most use bare `CREATE
TABLE`/`CREATE POLICY`/`ALTER TABLE ... ADD COLUMN` without `IF NOT EXISTS`, so re-running errors
on the first duplicate. `src/lib/supabase/types.ts` is in sync with all of them.

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_MANAGEMENT_TOKEN=          # migrations + type regen via Management API

# FareHarbor
FAREHARBOR_API_APP=
FAREHARBOR_API_USER=
FAREHARBOR_API_BASE=https://fareharbor.com/api/v1

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# AI
ANTHROPIC_API_KEY=                  # Claude Sonnet (text)
GOOGLE_AI_API_KEY=                  # Gemini (vision)

# Google Ads — conversion tracking + campaign management (share the OAuth below)
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=             # advertiser account (10 digits, no dashes)
GOOGLE_ADS_LOGIN_CUSTOMER_ID=       # manager / MCC account
GOOGLE_ADS_CONVERSION_ACTION_ID=
GOOGLE_ADS_API_VERSION=v20          # bump when Google sunsets a version
GOOGLE_ADS_REQUIRE_CONSENT=true

# Google — reviews / OAuth (GOOGLE_OAUTH_* is reused by Google Ads auth)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_PLACES_API_KEY=
GOOGLE_PLACE_ID=

# Reviews
OUTSCRAPER_API_KEY=

# Email / Slack
RESEND_API_KEY=
CATERING_EMAIL_RECIPIENT=
SLACK_WEBHOOK_URL=
SLACK_BOT_TOKEN=            # enables critical alerts to Beer's DM; without it, alerts silently
                            # fall back to the shared channel webhook only
SLACK_ALERT_DM_CHANNEL=     # has a hardcoded fallback channel id if unset

# Testing / dev flags
SUPPRESS_CONFIRMATION_EMAILS=   # test-mode: suppress outbound Resend emails during manual testing

# Site / deploy
NEXT_PUBLIC_SITE_URL=https://offcourseamsterdam.com
REVALIDATION_SECRET=
VERCEL_API_KEY=
```

> Keys live in `.env.local` (gitignored); **`.env.example` is the source-of-truth list** — keep them in sync. (Removed stray non-keys `GOOGLE_API_KEY`, `OAUTH_CLIENT_ID`, and the malformed `SLACK …` lines; `VERCEL_OIDC_TOKEN` is auto-injected by the Vercel CLI and isn't configured here.)

## Brand Identity & Content Guidelines

### DNA — Why We Exist
Off Course was born from one feeling: being on the water feels like home. The vision is a world where more people find peace on the water — where tourists feel like locals and locals feel like themselves. The mission: we create boats with vibes so good, the effect is instant. You're relaxed, connected, and fully present.

**Proposition:** "Your friend with a boat." Not a tour company — the friend who happens to have a boat and knows all the good spots.

**Positioning:** Not your average canal tour. Off Course is for people who want to experience the real Amsterdam — its hidden gems and local rhythm. We sit between budget tourist boats and stiff luxury charters. We're the sweet spot: quality, taste, and zero pretension.

**Name meaning:** "Off Course" is a double meaning — freedom, drifting, exploration, spontaneous, off the beaten path. Plus the obvious: "of course."

### Core Values (use these to guide ALL content decisions)
1. **Effortless** — everything looks and feels easy. No friction, no fuss.
2. **Local** — rooted in Amsterdam. We know the city like the back of our hand.
3. **Memorable** — we create moments people talk about long after.
4. **Chill** — relaxed energy, never rushed, never forced.

### Tone of Voice — "This is how we talk"
The essence: a laid-back, familiar voice with dry humor and warmth. Like your funniest friend who always has an extra towel.

**5 Tone Pillars:**
1. **Warm & Welcoming** — like greeting an old friend. Inclusive, never exclusive. "Come as you are" energy.
2. **Unpolished on Purpose** — we don't over-edit. Slightly raw, slightly imperfect. Real over polished. Never corporate.
3. **Dry Playful Humor** — subtle, never forced. A wink, not a punchline. Think deadpan Amsterdam meets Brooklyn dry wit.
4. **Relaxed Casual Flow** — sentences can be short. Or long and winding. Like a canal. Conversational rhythm, not copywriter rhythm.
5. **Low-Key Poetic** — we sneak in beauty. "The light hits different from the water." Not flowery — grounded poetry.

**Phrase banks to draw from:**
- About Us: "started with one boat and a dream (cliché but true)", "we know the city like the back of our hand", "your friend with a boat"
- Common: "off the beaten path", "hidden gems", "the real Amsterdam", "local rhythm", "vibes are immaculate"
- Making people feel at home: "come as you are", "no dress code, no nonsense", "we'll handle the rest"
- Water phrases: "the light hits different from the water", "the city slows down from here", "every canal tells a story"

### Target Personas (guide content and UX decisions)

**Sierra** — Shared Cruise persona
- 34, UX Designer from Austin. Travels for texture, not tourist traps.
- Style: Everlane, GANNI, Aesop, Kinfolk magazine. Curated but effortless.
- Wants: intimate, aesthetic, effortless cool. "No Heineken hats, no loud music."
- Finds us through: Instagram Reels, design blogs, curated travel guides.
- Needs to feel: "this was made for someone like me."

**Tariq** — Private Cruise persona
- 38, Project Manager + DJ living in Amsterdam Oud-West. Depth over hype.
- Style: anti-flashiness, quiet design, substance over status.
- Wants: hidden gems over hotspots. Hosting friends who visit, showing them the real city.
- Finds us through: word of mouth, local recommendations, Google.
- Needs to feel: "these people actually get Amsterdam."

### Visual Identity
- **Colors:** deep indigo/blue (primary), crimson red (accent), lavender, lime green, pink
- **Photography style:** warm, candid, golden-hour light. Polaroid-frame aesthetic. Real moments, not staged. Eclectic creative spaces vibe.
- **Tagline:** "we're down to water"
- **Merch aesthetic:** hoodies, jackets with OFFCOURSE repeat pattern. Streetwear-meets-nautical.

### Hard Rules for Content Generation
- Brand name "Off Course" is NEVER translated in any language
- Boat names "Diana" and "Curaçao" are NEVER translated
- "Hidden gems" = translate the MEANING, not literally
- "Skipper" = use local equivalent (schipper in NL, Kapitän in DE, capitán in ES, etc.)
- Founders: Jannah & Beer
- Boats: Diana (max 8 guests, intimate & cozy), Curaçao (max 12 guests, spacious & social)
- All boats are electric and sustainable — mention naturally, never preachy
- NEVER sound like a corporate tour company. No "embark on a journey", no "exclusive experience", no "book now to avoid disappointment"
- NEVER use luxury-coded language ("exclusive", "premium", "bespoke", "curated experience")
- NEVER be preachy about sustainability — it's just how we roll
- DO sound like a friend texting you about plans. Casual, warm, real.
- DO use humor sparingly and dryly — a wink, not a LOL
- DO let the beauty of Amsterdam speak — we just set the scene



# Off Course Amsterdam — Next.js Rebuild

## Project Overview

Off Course Amsterdam is "your friend with a boat" — an electric boat company in Amsterdam offering private and shared canal cruises through the city's hidden gems. Not a tour company, not luxury — the sweet spot between taste and zero pretension. This is a full rebuild from Lovable (React) to Next.js, with a search-first booking flow, native Stripe checkout, and an admin backend.

**Stack:** Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Supabase · Stripe · FareHarbor External API v1 · Claude Sonnet (text AI) · Google Gemini (vision AI) · Vercel

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

### Dev Server (CRITICAL)
Next.js 16 Turbopack CANNOT run inside Claude Code's preview server or Bash environment (macOS sandbox limitation).

**How to develop:**
1. Beer runs `npm run dev` from his own Terminal.app (NOT from Claude Code)
2. Claude Code edits code and reads files as normal
3. For visual verification, use Claude in Chrome MCP tools to browse `http://localhost:3000`
4. Do NOT use `preview_start` or run the dev server from Bash — it will always crash

### Turbopack Cache MUST Stay Disabled (CRITICAL)
`next.config.ts` has `experimental: { turbopackFileSystemCacheForDev: false }`. **NEVER remove this.**

**Why:** Turbopack uses RocksDB for persistent caching. RocksDB only allows one write at a time. This project (21 pages × 7 locales) generates enough concurrent compilation to overwhelm RocksDB's single-writer lock. When writes collide, `.next/dev/build/postcss.js` fails to persist, PostCSS workers crash, `globals.css` can't compile, and the entire dev server dies.

**The `package.json` dev script auto-cleans `.next` on startup** (`rm -rf .next && next dev`) to prevent corrupted cache state from previous sessions. Do not remove the `rm -rf .next` part.

**Trade-off:** Cold starts are slightly slower (no cache to restore). But the server won't crash mid-session.

### proxy.ts vs middleware.ts (CRITICAL)
Next.js 16 renamed middleware → proxy. This project uses `src/proxy.ts` ONLY.
**NEVER create `src/middleware.ts`** — the build will fail if both exist.
If you need to modify request handling (auth, i18n, redirects), edit `src/proxy.ts`.

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
| Module | Tests | File |
|--------|-------|------|
| FareHarbor 3-layer filters | 30 | `src/lib/fareharbor/filters.test.ts` |
| Extras pricing math | 14 | `src/lib/extras/calculate.test.ts` |
| Formatting utilities | 18 | `src/lib/utils.test.ts` |

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

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
FAREHARBOR_API_APP=
FAREHARBOR_API_USER=
FAREHARBOR_API_BASE=https://fareharbor.com/api/v1
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=
GOOGLE_PLACES_API_KEY=
GOOGLE_PLACE_ID=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
NEXT_PUBLIC_SITE_URL=https://offcourseamsterdam.com
REVALIDATION_SECRET=
SLACK ACCESS TOKEN: 
SLACK REFRESH TOKEN:
SLACK_WEBHOOK_URL=
RESEND_API_KEY=
SUPABASE_MANAGEMENT_TOKEN=
VERCEL_API_KEY:
GOOGLE_API_KEY:
OAUTH_CLIENT_ID:
```

> Keys live in `.env.local` (gitignored). See `.env.example` for the full list.

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



# A smart Cmd+K for the admin — build plan

**Status:** ready to build, not started. Branch: `feature/ai-ops-engine-main-sync` (publish
there only — never `main`).

**Goal in one line:** press Cmd+K anywhere in the admin, type a guest's name, a chat
subject, or a partner like "Viator", and land on the actual record — not just a link to
the page it might be on.

**How this plan was made:** two research passes (a full inventory of the admin, plus how
Notion/Linear/Raycast/Superhuman/Slack/GitHub build their palettes), two competing plans,
and a merge. The merge was then **checked against the real codebase and the production
database, and three of its core claims turned out to be wrong.** This version replaces
it. The corrections are listed first so nobody rebuilds the earlier design from memory.

---

## What verification changed (2026-09-16)

| Earlier plan claimed | Reality | Consequence |
|---|---|---|
| We need a search index table (`admin_search_index`) kept fresh by `reindexEntity()` calls on every write | **Total searchable data is ~1,400 rows** (bookings 533, conversations 133, messages 235, Viator lines 79, every other source < 60) | An index is solving a problem we don't have. Query the tables live — always fresh, nothing to keep in sync. |
| Reindex-on-write is safe because writes happen in few places | `bookings` is written from **34 files**, `conversations` 14, `messages` 12, `partners` 9 | Every missed call = a silently stale result. Another reason to query live. |
| Finance tables are only filled via `/upload` routes | Also written by `classify`, `payout`, `set-bank-date` and `reconcile-payouts` | The "reindex at end of upload" idea was wrong. Moot now. |
| Use `pg_trgm` / `similarity()` | `pg_trgm` is **not installed** | Not needed at this scale; plain `ilike` + ranking in TypeScript. |
| Viator lines carry a guest name | `viator_payment_lines` has no guest column (only `viator_reference`, `vendor_reference`, `tour_grade_title`) | Viator records are found by reference/tour name, or by the keyword "viator" itself (below). |
| Results can deep-link to records | Only the inbox supports it (`?c=<id>`). Kasboek tabs and expanded booking rows are local React state | **Deep links are real work in this plan** (Step 3), not an assumption. |
| — | No `cmdk`, no dialog component, no existing Cmd/Ctrl+K handler | Add `cmdk`; no shortcut conflicts. |

**What survived from the debate:** one search route instead of one per entity; results
modeled as one shape (`nav` / `record` / `command`) so commands can be added later
without a rewrite; `Promise.allSettled` with a per-source timeout so one slow table never
blanks the palette; a weighted score instead of "nav always wins" (a guest called Diana
must not be buried under the boat Diana); recents shown before typing; single-letter
scope prefixes; staff/stock/maintenance stay out.

## Architecture in one paragraph

One route, `GET /api/admin/search?q=&types=`, runs a list of small **source adapters** in
parallel — one per searchable thing (bookings, chats, partners, promo codes, cruises, and
each finance source). Each adapter is a plain TypeScript object: which table, which
columns to `ilike`, which keywords point at it ("viator", "gyg"), and how to turn a row
into a result with a working link. Adding a searchable thing later = adding one adapter
file. Nav pages and Kasboek tabs are matched in the browser (instant). Ranking, query
parsing and recents are pure functions with unit tests. No migrations, no index, no
triggers, no cron.

---

## Build steps

### Step 1 — Pure core, tests first (`src/lib/admin/command-palette/`)

- `types.ts` — `PaletteItem { id, kind: 'nav'|'record'|'command', group, title, subtitle?, href, icon?, keywords? }`.
- `parse-query.ts` — optional prefixes `b ` bookings, `c ` chats, `f ` finance,
  `p ` partners/promo → `{ text, types }`. Tests: no prefix, each prefix, prefix with no text,
  "b" alone is a search for "b" not a prefix.
- `match.ts` — `matchQuality(query, fields)`: exact > word-start > substring > none;
  case- and accent-insensitive (**Curaçao** must match "curacao"); multi-word queries match
  when every word hits some field ("viator march"). Tests for each.
- `rank.ts` — `score = matchQuality × groupWeight + recencyBoost`, stable order, max 5 per
  group. Tests include the Diana case (strong booking hit beats weak nav hit) and "exact nav
  hit wins for a one-word page name like 'planning'".
- `nav-items.ts` — built from `navSections` + every Kasboek tab (with keywords:
  `viator`, `getyourguide`/`gyg`, `withlocals`, `boatlocal`, `click&boat`, `getmyboat`,
  `barqo`, `revolut`, `zettle`, `fareharbor`, `btw`/`vat`, `city tax`/`toeristenbelasting`)
  + finance sub-pages. Test: every `href` corresponds to a real `page.tsx` on disk (guards
  against dead links as routes move).
- `recents.ts` — last-opened items in `localStorage` with bucketed frecency (only 3 admin
  users; no database table). Every read/write in `try/catch`. Tests with a fake storage.

### Step 2 — Server search (one route + adapters)

- `src/lib/admin/command-palette/sources/` — one adapter per source:
  - **bookings**: `customer_name, customer_email, customer_phone, listing_title,
    booking_uuid, invoice_number, company_name`; keyword hits on `booking_source`
    (typing "viator" also returns the 2 Viator bookings, "boatlocal" the 57).
    Subtitle: date · cruise · guests · status. Link: `/admin/bookings?booking=<id>`.
  - **chats**: `conversations.subject, ota_guest_name, ota_booking_ref, ai_summary`;
    `contacts.name/email/phone_e164` (separate query, then map to their conversations);
    `messages.body` (last-match wins, snippet in subtitle). Link: `/admin/inbox?c=<id>`, or
    `/admin/finance/inbox?c=<id>` when `source_category = 'finance'`.
  - **partners**, **promo codes**, **cruise listings** (`title, slug, category`).
  - **finance**, one adapter per source using the verified columns: Viator batches
    (`document_number`) + lines (`viator_reference, vendor_reference, tour_grade_title`),
    GetYourGuide (`payment_number, invoice_number`), Withlocals (`booking_id, guest_name,
    tour_name, invoice_number`), BoatLocal lines (`guest_name, cruise_name`) + batches
    (`invoice_number`), Click&Boat (`charter_number, listing_title`), GetMyBoat
    (`booking_id, guest_name`), Barqo (`booking_number, guest_name, boat_name`), Revolut
    (`description, customer_name, transaction_id`), FareHarbor payouts (`payout_id,
    bank_note`), expenses (reuse the existing `listExpenses` search). **Keyword rule:** when
    the query *is* the source's name ("viator"), the adapter returns that source's most
    recent records instead of a text match. Link: `/admin/finance?tab=<source>` (plus the
    record's reference in the subtitle).
- `run-search.ts` — runs adapters with `Promise.allSettled`, **~800ms per-source timeout**,
  flattens results, returns which sources failed (the UI shows "some sources didn't
  answer" instead of an empty list). Tests with fake adapters: one throws, one times out,
  the rest still return.
- **Input escaping** — PostgREST `.or()` filters break (or can be manipulated) on `,` `(`
  `)` `%` `_` in user input. One `escapeIlike()` helper, used by every adapter, with tests.
  The two existing `?q=` routes don't do this today; fix them in the same change.
- `src/app/api/admin/search/route.ts` — `export async function GET` with `requireAdmin()`
  first (a shape `admin-route-contract.test.ts` already recognizes — re-run it to confirm
  the route is picked up, not skipped). Query < 2 chars → empty result. `route.test.ts`
  covers the 401 gate, `types=` filtering, the length guard and partial failure.

### Step 3 — Deep links, so results land on the record

- **Bookings** `?booking=<id>` → clear filters that would hide it, expand that row,
  scroll it into view, brief highlight.
- **Kasboek** `?tab=<TabKey>` → open on that tab (validated against `ALL_TAB_KEYS`).
- **Finance expenses / transactions** `?q=` → prefill their existing search box.
- Already fine: inbox and finance inbox (`?c=`), `/admin/partners/[id]`,
  `/admin/cruises/[id]`.

### Step 4 — The palette UI

- Add `cmdk` (brings `@radix-ui/react-dialog`). Server results use `shouldFilter={false}`;
  nav items are ranked by our own `rank.ts`, not cmdk's built-in filter.
- `src/components/admin/command-palette/CommandPalette.tsx`, mounted once in
  `src/app/[locale]/admin/layout.tsx`:
  - Cmd+K / Ctrl+K opens and closes; Escape closes; arrows + Enter; Cmd/Ctrl+Enter opens in
    a new tab.
  - Nav matches render instantly; server results after a **200ms debounce**, previous
    request aborted on each keystroke.
  - Empty state: recents + suggested (Bookings, Inbox, Kasboek, Planning).
  - Group order: Go to · Bookings · Chats · Finance · Partners & promo · Cruises.
  - Styled with the admin design tokens (navy / section colors), each group headed by its
    section color dot.
- **One search concept, not two:** the sidebar's search field becomes the palette trigger
  (shows "Search ⌘K"), which also gives mobile users a way to open it.

### Step 5 — Verify and ship

- `npm test`, `tsc`, lint on touched files.
- Browser: "Viator" (tab + recent batches + Viator bookings), a real guest name, a chat
  subject, "curacao", each prefix, a nonsense query, mobile width, Cmd+Enter.
- `docs/features/command-palette.md` + index entry in `docs/features/README.md`.
- Commit, push to `feature/ai-ops-engine-main-sync` (fast-forward only, never `main`).

## Not in this build (deliberately)

- **Commands** (cancel booking, resend confirmation, mark catering sent). The result shape
  is ready for them, but they change real data, so they need their own confirmation UX —
  a separate, small follow-up.
- **A search index** — revisit only when a single table passes ~20,000 rows.
- Staff, stock, maintenance, homepage content.
- The orphaned `/admin/affiliates` page (calls an API route that doesn't exist) — excluded
  from nav items; fixing or deleting it is a separate task.

## Remaining risks (why confidence is ~85%, not 100%)

1. **Bookings deep link vs. the page's own filters** — the page has several filters and a
   created-date range; forcing a row visible without confusing the filter UI needs care.
2. **Chat search across three tables** (conversations, contacts, messages) is the
   fiddliest adapter; the contacts→conversations mapping may need an extra query.
3. **`cmdk` + Tailwind v4 styling** — minor, but untested in this repo.
4. **Latency:** ~15 small parallel queries from Vercel should land around 100–300ms total.
   If it's slower in practice, the fallback is one Postgres function that runs all the
   searches in a single round trip (logic moves to SQL, so it's a fallback, not the default).

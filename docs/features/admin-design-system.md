# Admin design system — "Ink & Color Coded"

## What was built

A visual redesign of the admin panel's shared chrome: a dark navy sidebar where each
nav group (Operations, Content, Marketing, Performance, Admin, Dev) gets its own brand
color from the public homepage's palette, a small colored "eyebrow" label above every
page's title showing which group it belongs to, and a warm off-white page background
in place of the old cold `zinc-50`. Cards, tables, tabs, inputs, badges and buttons were
retinted to match.

Explicitly **not** carried over from the homepage: the Briston/Palmore display fonts and
the grain textures. Beer said the homepage's look is "too annoying to work with on a
daily basis" for something used every day — the admin now uses DM Sans (a plain, modern
UI face) and flat colors instead.

Three directions were mocked up first on a design canvas (indigo sidebar / lavender
light / this one) and Beer picked **Direction C**.

## Key files

- [`src/lib/admin/nav-sections.ts`](../../src/lib/admin/nav-sections.ts) — the single
  source of truth for the nav structure *and* the section → color mapping (`color` = a
  bright brand swatch, `ink` = a readable-on-light version). The sidebar and every
  page's eyebrow read from here, so they can never disagree about which color belongs
  to which section.
  color from a pathname. Also owns `isNavItemActive()` / `stripLocale()` (tested in
  `nav-sections.test.ts`).
- [`src/components/layout/DashboardSidebar.tsx`](../../src/components/layout/DashboardSidebar.tsx) —
  restyled: navy background, a working search filter over nav items, real
  active-route highlighting (the old sidebar never detected the current page — a
  pre-existing gap, fixed here), collapsible groups. The existing mobile off-canvas
  drawer, icon rail and the three live badges (catering, inbox, finance inbox) are kept.
- [`src/components/admin/ui/AdminEyebrow.tsx`](../../src/components/admin/ui/AdminEyebrow.tsx) —
  the small "● Content" label above a page's `<h1>`. Takes a `label` prop (not a
  pathname hook) so it drops into both server and client page components.
- `src/app/globals.css` — new `:root` block of `--admin-*` tokens (background, ink,
  navy, borders…) plus a `[data-admin]`-scoped block of `--ui-button-*` overrides that
  `button.tsx` reads.
- `src/app/[locale]/admin/layout.tsx` — loads DM Sans via `next/font/google` under the
  admin route only, applies the new background token (Voice phone + AI Ops Center bar
  unchanged, just retinted).
- `src/components/ui/{button,card,badge,table,tabs,input,separator}.tsx` — retinted.

## Architecture decisions

**Colors live in one shared TypeScript module, not duplicated per page.** Before this
change, `navSections` was defined inline in `layout.tsx` with no shared type. Moving it
to `src/lib/admin/nav-sections.ts` means the sidebar's color-coded dots and every page's
eyebrow are reading the *same* `color`/`ink` values — change Marketing's pink to a
different pink once, and it updates the sidebar dot, the active-nav-item icon tint, and
every Marketing page's eyebrow simultaneously.

**Button, Card, Badge, Table, Tabs, Input and Separator were checked for non-admin
usage before editing.** `Card`, `Badge`, `Table`, `Tabs`, `Input` and `Separator` had
zero callers outside `src/app/[locale]/admin` — safe to hardcode the new palette
directly. `Button` *is* used by the public booking flow (`BookingPanelSlider`,
`BookingPanelDesktop`), but only ever with an explicit `variant` — never the bare
`default` variant this change repaints. To keep that guarantee true even if that
changes later, `default`'s colors are read from `--ui-button-bg`/`--ui-button-fg`/
`--ui-button-bg-hover` CSS custom properties with the *original* zinc values as the
literal Tailwind fallback (`bg-[var(--ui-button-bg,#18181b)]`) — undefined anywhere
outside `[data-admin]`, so the public site's rendering is provably unchanged.

**Admin-wide tokens live on `:root`, not `[data-admin]`.** `DashboardSidebar` turned out
to be reused by two other portals — `/captain` and `/support` — neither of which wraps
itself in `data-admin`. The `--admin-*` tokens (navy, ink, borders, backgrounds) are
therefore defined globally on `:root` so those portals' sidebars resolve real colors
instead of blank/transparent ones; only the `--ui-button-*` Button overrides stay scoped
to `[data-admin]`, since widening *those* would repaint captain/support's buttons too
(out of scope for this change, and not asked for).

**The eyebrow is a dumb, prop-driven component, not a `usePathname()` hook.** Some admin
pages are server components, some are client components; a component that reads the
route itself would force every page that uses it into `'use client'`. `AdminEyebrow`
just takes `label="Content"` and looks the color up — it works unchanged in either kind
of page.

## How it works

1. `AdminLayout` renders `<div data-admin>` and loads DM Sans as `--font-admin-sans`.
2. `globals.css`'s existing `[data-admin] h1, h2, … { font-family: var(--admin-font) }`
   rule (previously hardcoded to a generic system-font stack) now points at that
   variable — one line changed, same mechanism that was already resetting the
   homepage's display fonts inside admin.
3. `DashboardSidebar` renders `navSections` from `nav-sections.ts`, coloring each
   section's label dot, and — via `usePathname()` + `isNavItemActive()` — highlighting
   whichever nav item matches the current route with that section's brand color.
   Two matching rules matter: a portal root like the `/admin` Dashboard only matches
   *exactly* (otherwise every admin page would light it up), and an item can set
   `activePrefix` when its link differs from the area it represents — Finance links to
   `/admin/finance/overview` but every `/admin/finance/*` page highlights it.
4. Every admin page renders `<AdminEyebrow label="…" />` directly above its own title —
   all of Operations (Dashboard, Bookings, Inbox, Catering, Planning, Availability,
   Maintenance, Stock, Reviews), Content, Marketing (incl. the `[id]` detail pages and
   legacy `affiliates`), Performance (Statistics, Google Ads, and every Finance
   sub-page), Admin and Dev (Ghost AI + Rulebook, Notifications, FareHarbor, Image
   Optimization). The inbox shell is shared by `/admin/inbox` and
   `/admin/finance/inbox`, so it picks Operations or Performance from its `scope` prop.
   A one-line addition per page — no data fetching or actions touched.
5. Shared primitives (`Card`, `Badge`, `Table`, buttons, inputs) pick up the new palette
   automatically wherever a page already uses them — no per-page styling work needed
   for the rest of each page's body.

## How to extend

- **Add a new admin page under an existing section:** add its `NavItem` to the right
  section in `nav-sections.ts`, add `<AdminEyebrow label="ThatSection" />` above your
  page's `<h1>`. Done — sidebar entry, active-state highlight and eyebrow color all
  come for free.
- **Add a new section:** add a `NavSection` to `nav-sections.ts` with a `color` (bright
  swatch, used for dots/active icons — keep it one of the existing homepage brand colors
  in `--color-lavender`/`--color-lime`/`--color-pink`/`--color-yellow`/`--color-cta`
  rather than inventing a new hue) and an `ink` (a darkened, readable-on-`#faf8f4`
  version of it for text).
- **Retheme the whole admin:** the `--admin-*` and `--ui-button-*` custom properties in
  `globals.css` are the one place to change. Nothing else hardcodes a hex value for the
  shell chrome.
- **A nav item whose link isn't the root of its area** (like Finance): set
  `activePrefix` on it, and add a case to `nav-sections.test.ts`.

## Dependencies

- Depends on: the existing `[data-admin]` attribute convention and font-reset rule in
  `globals.css` (this change extends both, doesn't replace them); `next/font/google`
  (new — the public site only used `next/font/local` before this).
- Depended on by: any future admin page or portal (`captain`, `support`) that renders
  `DashboardSidebar` — its `navSections` prop must now satisfy the `NavSection` type
  (`color` + `ink` required), not the old untyped inline shape.

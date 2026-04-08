# Track A: Core Setup + Infrastructure

**Track:** A — Phase 1 (MVP)
**PR:** [#1 — Track A: Core setup + infrastructure](https://github.com/offcourseamsterdam/Next.JS-Off-Course-Website/pull/1)
**Status:** Done

---

## What was built

The foundational layer of the Next.js app: project scaffolding, Supabase clients, 7-locale i18n routing, shared layout components (Navbar, Footer, WhatsApp button), Tailwind v4 design tokens, and shared utility/type files.

No external API calls are made yet — this track sets up the plumbing that all other tracks build on.

---

## Key files

### App shell
| File | Description |
|------|-------------|
| `src/app/layout.tsx` | Root layout — sets default metadata, imports `globals.css` |
| `src/app/[locale]/layout.tsx` | Locale layout — wraps every page with `NextIntlClientProvider`, Navbar, Footer, WhatsApp button |
| `src/app/[locale]/page.tsx` | Homepage placeholder — replaced in Track B |
| `src/app/page.tsx` | Root redirect to `/en` |
| `src/app/globals.css` | Tailwind v4 `@theme` tokens + base styles |

### i18n
| File | Description |
|------|-------------|
| `src/proxy.ts` | next-intl routing middleware (Next.js 16 calls this `proxy.ts`, not `middleware.ts`) |
| `src/i18n/routing.ts` | Locale list and default locale for next-intl |
| `src/i18n/request.ts` | Server-side message loader — loads EN as base, merges locale-specific translations on top |
| `src/i18n/navigation.ts` | Typed `Link`, `useRouter`, `usePathname` exports for locale-aware navigation |
| `src/lib/i18n/config.ts` | Locale constants, names, and flag emojis |
| `src/lib/i18n/get-localized-field.ts` | Helper to read `field_nl` / `field_de` / … from Supabase rows, with English fallback |
| `src/lib/i18n/messages/en.json` | All English UI strings (nav, footer, search, booking, checkout, 404) |
| `src/lib/i18n/messages/{nl,de,fr,es,pt,zh}.json` | Placeholder files — AI-translated in Track I |

### Supabase
| File | Description |
|------|-------------|
| `src/lib/supabase/client.ts` | Browser client using `createBrowserClient` from `@supabase/ssr` |
| `src/lib/supabase/server.ts` | Server client (`createClient`) and service role client (`createServiceClient`) |
| `src/lib/supabase/types.ts` | Hand-written database types covering all tables used in Phase 1 |

### Layout components
| File | Description |
|------|-------------|
| `src/components/layout/Navbar.tsx` | Sticky nav: logo, page links, language switcher dropdown, Book Now CTA, mobile hamburger |
| `src/components/layout/Footer.tsx` | Brand footer: logo, tagline, nav links, social links, legal links, copyright |
| `src/components/layout/WhatsAppButton.tsx` | Fixed floating WhatsApp button (bottom-right) |

### Utilities + types
| File | Description |
|------|-------------|
| `src/lib/utils.ts` | `cn()` classname helper, `formatPrice()`, `formatDate()`, `formatShortDate()`, `formatDuration()`, `slugify()` |
| `src/types/index.ts` | Shared TypeScript types: `CruiseListing`, `AvailabilitySlot`, `SearchParams`, `SearchResult`, `BookingState`, `CustomerDetails` |

---

## Architecture decisions

### Next.js 16 + `proxy.ts`
The scaffold installed Next.js 16 (latest at time of build), not 14 as originally planned. Next.js 16 with Turbopack renames `middleware.ts` to `proxy.ts`. All middleware (currently just locale routing) lives there.

### Tailwind v4 `@theme` instead of `tailwind.config.js`
Tailwind v4 (also installed as latest) no longer uses a config file. Design tokens are declared as CSS custom properties inside `@theme {}` in `globals.css`. Use them as `var(--color-primary)` in CSS or `text-[var(--color-primary)]` in Tailwind classes.

### next-intl v4 message fallback
Non-English locale files are empty `{}` until Track I generates AI translations. Rather than crashing, `src/i18n/request.ts` loads `en.json` as the base and deep-merges the locale file on top. Any missing key silently falls back to English.

### Hand-written Supabase types
Running `supabase gen types` requires the Supabase CLI to be set up locally. The types in `src/lib/supabase/types.ts` were written by hand to cover the tables needed for Phase 1. Regenerate with the real CLI when schema changes:
```bash
npx supabase gen types typescript --project-id fkylzllxvepmrtqxisrn > src/lib/supabase/types.ts
```

---

## How it works

### Request flow
```
Browser request → proxy.ts (locale detection)
  → /en/... → src/app/[locale]/layout.tsx
    → loads messages for locale (EN fallback)
    → renders NextIntlClientProvider + Navbar + {page} + Footer + WhatsApp button
```

### Locale switching
The Navbar `LocaleSwitcher` calls `router.replace(pathname, { locale: next })` from `src/i18n/navigation.ts`. next-intl rewrites the URL prefix (e.g. `/en/cruises` → `/nl/cruises`) and reloads with the new locale's messages.

### Reading localized content from Supabase
Every content table has `_nl`, `_de`, `_fr`, `_es`, `_pt`, `_zh` columns. Use `getLocalizedField` to read the right one:
```ts
import { getLocalizedField } from '@/lib/i18n/get-localized-field'

const title = getLocalizedField(listing, 'title', locale)
// locale='nl' → listing.title_nl ?? listing.title
// locale='en' → listing.title
```

---

## How to extend

### Add a new page
Create `src/app/[locale]/your-page/page.tsx`. It automatically gets the locale layout (Navbar + Footer). Use `useTranslations('your-namespace')` for UI strings and add the keys to `src/lib/i18n/messages/en.json`.

### Add a new UI string
1. Add the key to `src/lib/i18n/messages/en.json`
2. Use it: `const t = useTranslations('namespace'); t('key')`
3. Translations for other locales are added in Track I via Claude Sonnet

### Add a new shared type
Add it to `src/types/index.ts`. Keep types as plain interfaces — no classes.

### Add a new utility
Add to `src/lib/utils.ts`. Keep utilities pure functions with no side effects.

---

## Dependencies

**This track depends on:** nothing — it's the foundation.

**The following tracks depend on this:**
- Track B (public pages) — uses layout, i18n, Supabase client, utilities
- Track C (FareHarbor) — uses Supabase client, shared types
- Track D (Stripe) — uses Supabase client, shared types
- All subsequent tracks — use layout, i18n, utilities

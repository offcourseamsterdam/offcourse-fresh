# Off Course Amsterdam — Next.js Website

"Your friend with a boat." Electric canal cruises through Amsterdam's hidden gems.

**Stack:** Next.js 16 · TypeScript · Tailwind CSS v4 · Supabase · Stripe · FareHarbor API · Vercel

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your keys
cp .env.example .env.local

# 3. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/en` automatically.

---

## Project structure

```
src/
├── app/
│   ├── [locale]/              # All public pages live here (locale-aware)
│   │   ├── layout.tsx         # Wraps every page: Navbar + Footer + i18n provider
│   │   ├── page.tsx           # Homepage (placeholder → built in Track B)
│   │   └── cruises/[slug]/    # Cruise detail pages (Track B)
│   ├── api/                   # API routes — all external calls go through here
│   │   ├── fareharbor/        # FareHarbor availability + booking (Track C)
│   │   └── stripe/            # Stripe payment intents + webhooks (Track D)
│   ├── layout.tsx             # Root layout — sets metadata, imports globals.css
│   ├── page.tsx               # Root redirect → /en
│   └── globals.css            # Tailwind v4 @theme tokens + base styles
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx         # Sticky nav with locale switcher + mobile menu
│   │   ├── Footer.tsx         # Brand footer with links and social
│   │   └── WhatsAppButton.tsx # Floating WhatsApp CTA (bottom-right)
│   ├── booking/               # Booking flow components (Track D)
│   ├── ui/                    # Shared UI primitives
│   └── sections/              # Homepage section components (Track B)
├── i18n/
│   ├── routing.ts             # next-intl route config (locales + default)
│   ├── request.ts             # Server-side message loader with EN fallback
│   └── navigation.ts          # Typed Link, useRouter, usePathname exports
├── lib/
│   ├── supabase/
│   │   ├── client.ts          # Browser Supabase client
│   │   ├── server.ts          # Server Supabase client (cookie-based auth)
│   │   └── types.ts           # Database type definitions (hand-written; regenerate below)
│   ├── fareharbor/            # FareHarbor API wrapper + filter engine (Track C)
│   ├── stripe/                # Stripe server client (Track D)
│   ├── ai/                    # Claude Sonnet (text) + Gemini (vision) clients (Track I)
│   ├── i18n/
│   │   ├── config.ts          # Locale list, names, flags
│   │   ├── get-localized-field.ts  # Read field_nl / field_de / … from Supabase rows
│   │   └── messages/          # UI string JSON files per locale
│   └── utils.ts               # cn(), formatPrice(), formatDate(), formatDuration()
├── proxy.ts                   # next-intl routing middleware (Next.js 16 = proxy.ts)
└── types/
    └── index.ts               # Shared TypeScript types (CruiseListing, BookingState, …)
```

---

## Key concepts

### Locale routing

Uses **next-intl v4**. Every page lives under `src/app/[locale]/`. The `proxy.ts` middleware detects the browser's preferred language and redirects accordingly.

Supported locales: `en` (default) · `nl` · `de` · `fr` · `es` · `pt` · `zh`

Non-English translations are AI-generated (Track I). Until then, all locales fall back to English automatically.

```ts
// Reading a localized string from a Supabase row:
import { getLocalizedField } from '@/lib/i18n/get-localized-field'

const title = getLocalizedField(listing, 'title', locale)
// → listing.title_nl ?? listing.title  (for locale = 'nl')
```

### Supabase clients

Three clients for different contexts:

| File | Used in | Key |
|------|---------|-----|
| `lib/supabase/client.ts` | Client Components | `NEXT_PUBLIC_ANON_KEY` |
| `lib/supabase/server.ts` — `createClient()` | Server Components, API routes | `NEXT_PUBLIC_ANON_KEY` + cookies |
| `lib/supabase/server.ts` — `createServiceClient()` | Admin API routes only | `SERVICE_ROLE_KEY` |

Never use the service client in public-facing code. It bypasses Row Level Security.

Regenerate types after any schema change:

```bash
npx supabase gen types typescript --project-id fkylzllxvepmrtqxisrn > src/lib/supabase/types.ts
```

### Virtual product layer

FareHarbor has a small number of items (boat types). The database maps many `cruise_listings` (virtual products) to each FareHarbor item. Each listing has:

- **Layer 1** — which boats are allowed (`allowed_resource_pks`)
- **Layer 2** — which durations are allowed (`allowed_customer_type_pks`)
- **Layer 3** — time/date rules (`availability_filters` JSON)

All three layers are applied in `src/lib/fareharbor/filters.ts` (Track C).

### Design tokens

Tailwind v4 — no `tailwind.config.js`. Tokens are defined as CSS custom properties in `src/app/globals.css`:

```css
@theme {
  --color-primary:  #1B2A6B;  /* deep indigo */
  --color-accent:   #C41E3A;  /* crimson red */
  --color-lavender: #B8A9C9;
  --color-lime:     #A8D65A;
  --color-pink:     #F4829A;
  --color-sand:     #F5F0E8;  /* warm off-white bg */
}
```

Use them as `text-[var(--color-primary)]` or directly as CSS variables.

---

## Environment variables

Copy `.env.example` → `.env.local` and fill in:

| Variable | What it is |
|----------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role — server only, never expose |
| `FAREHARBOR_API_APP` | FareHarbor app API key |
| `FAREHARBOR_API_USER` | FareHarbor user API key |
| `STRIPE_SECRET_KEY` | Stripe secret key — server only |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (safe to expose) |
| `STRIPE_WEBHOOK_SECRET` | Set after configuring Stripe webhook (Track D) |
| `ANTHROPIC_API_KEY` | Claude Sonnet — text AI (Track I) |
| `GOOGLE_AI_API_KEY` | Gemini — vision AI (Track I) |
| `NEXT_PUBLIC_SITE_URL` | Full site URL for metadata and OG tags |
| `REVALIDATION_SECRET` | Random string for ISR on-demand revalidation (Track B) |

---

## Development phases

| Phase | Tracks | Status |
|-------|--------|--------|
| 1 — MVP | A (infra), B (public pages), C (FareHarbor), D (Stripe) | A done |
| 2 — Admin | E (auth), F (operations), G (content management) | pending |
| 3 — Tooling | H (Slack), I (AI + SEO), J (dev tools) | pending |

Full implementation plan: [`docs/implementation-plan.md`](docs/implementation-plan.md)

---

## Useful commands

```bash
npm run dev        # start dev server
npm run build      # production build
npm run lint       # ESLint
npx tsc --noEmit   # TypeScript check (zero errors expected)
```

# Track A: Core Setup + Infrastructure

**Phase:** 1 (MVP)
**Dependencies:** None — this is the first track
**Must complete before:** Tracks B, C, D

## Objective
Scaffold the Next.js project, configure Supabase client, set up i18n routing, and build the shared layout (navigation, footer, WhatsApp button).

## Steps

### A1. Project Scaffold
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir
```

Install dependencies:
```bash
npm install @supabase/supabase-js @supabase/ssr stripe @stripe/stripe-js @stripe/react-stripe-js next-intl framer-motion sharp zod date-fns @anthropic-ai/sdk @google/generative-ai
```

### A2. Environment Setup
Create `.env.local` with all variables from CLAUDE.md.
Create `.env.example` with empty values for documentation.

### A3. Supabase Client
- `src/lib/supabase/client.ts` — browser client (uses `NEXT_PUBLIC_` keys)
- `src/lib/supabase/server.ts` — server client (uses `SUPABASE_SERVICE_ROLE_KEY`, cookie-based auth)
- `src/lib/supabase/types.ts` — generated types (run `npx supabase gen types typescript`)

### A4. i18n Configuration
- Install and configure `next-intl` with App Router
- `src/lib/i18n/config.ts` — locales array, default locale
- `src/lib/i18n/messages/en.json` — English UI strings (nav, buttons, common labels)
- `src/middleware.ts` — locale detection + routing
- `src/app/[locale]/layout.tsx` — locale-aware root layout

Supported locales: `en` (default), `nl`, `de`, `fr`, `es`, `pt`, `zh`

**Note:** Only create `en.json` for now. Other locale files will be AI-generated in a later phase. For now, create placeholder empty JSON files for each locale so the app doesn't error.

### A5. Shared Layout Components
- `src/components/layout/Navbar.tsx` — responsive nav with locale switcher
  - Links: Home, Our Cruises (dropdown with listings), Merch, The Cozy Crew, Book Now (CTA)
  - Mobile hamburger menu
  - Language dropdown (7 locales with flag icons)
- `src/components/layout/Footer.tsx` — links, social media, legal pages
- `src/components/layout/WhatsAppButton.tsx` — floating WhatsApp button (bottom-right)
- `src/app/[locale]/layout.tsx` — wrap pages in Navbar + Footer

### A6. Tailwind + Design Tokens
Set up Tailwind config with Off Course brand colors, typography, spacing.
- Reference the current site (offcourseamsterdam.com) for color palette
- Configure dark mode: off (not needed for this project)

### A7. Utility Files
- `src/lib/i18n/get-localized-field.ts` — helper to read `field` or `field_{locale}` from Supabase rows
- `src/lib/utils.ts` — cn() classname helper, formatPrice(), formatDate()
- `src/types/index.ts` — shared TypeScript types

## Verification Checklist
- [ ] `npm run dev` starts without errors
- [ ] Visiting `/` redirects to `/en`
- [ ] Visiting `/nl` renders Dutch layout
- [ ] Navbar renders on all pages with working locale switcher
- [ ] Footer renders with all links
- [ ] WhatsApp button visible and clickable
- [ ] Supabase client can connect (test with a simple query)
- [ ] Environment variables loaded correctly
- [ ] TypeScript compilation: zero errors

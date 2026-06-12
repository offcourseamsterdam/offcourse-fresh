# Headless WordPress Blog (WP SEO AI)

## What was built

A blog wing for the public site, where the **words live in a separate building**.
WordPress (running the WP SEO AI plugin) is a *headless content backend*: the AI
writes SEO blog posts into a custom post type there, and Next.js reads them over
the WordPress REST API and renders them as native, fully-styled pages under
`/{locale}/blog`. Nobody visits WordPress directly — the public only ever sees
this Next.js site.

End state: a post published in WordPress appears on the live site within ~1 hour
(ISR), styled like the rest of Off Course, indexed by Google with BreadcrumbList
+ Article structured data, and listed in the existing sitemap.

## Key files

| File | Role |
|------|------|
| `src/lib/wp/client.ts` | Data layer + pure helpers + public URL builders. Fetches published posts over REST, follows `X-WP-TotalPages` pagination, and **degrades to empty on any failure** so the build never breaks. |
| `src/lib/wp/client.test.ts` | Unit tests for helpers, URL builders, and the resilience guards. |
| `src/app/[locale]/(public)/blog/page.tsx` | Archive page — responsive card grid + BreadcrumbList JSON-LD. |
| `src/app/[locale]/(public)/blog/[slug]/page.tsx` | Single post — `generateStaticParams` (SSG), `generateMetadata` (canonical/OG), `notFound()` for unknown slugs, BreadcrumbList + Article JSON-LD. |
| `src/app/sitemap.ts` | **Extended** (not replaced) to add blog posts + the archive across all locales. |
| `next.config.ts` | Adds the WordPress media host to `images.remotePatterns`, derived from `WORDPRESS_URL`. |
| `.env.example` | Documents `WORDPRESS_URL` + `WP_POST_TYPE`. |

## Architecture decisions (the non-obvious ones)

- **Resilient-by-default reads.** The whole site is one Next.js app. `getAllPosts()`
  is called at build time by both the sitemap and `generateStaticParams`, so if it
  threw (WordPress down, env unset), the *entire site build* would fail. Instead it
  catches everything and returns `[]`. "No posts yet" is an acceptable fallback; a
  broken build is not. WordPress can be wired up later with zero risk to the live site.

- **Lives under `[locale]`, not a flat `/blog`.** The whole public site is
  locale-prefixed (`/en/...`, `/nl/...`), so the blog joins that structure for URL
  consistency and future localization. WordPress content is **single-language for
  now**, so the same English posts are pre-rendered under every locale. When WP gains
  translations (WP SEO AI / WPML), `getAllPosts`/`getPostBySlug` can take a `lang`.

- **Extends the native sitemap; does NOT add a rival sitemap route.** Next.js cannot
  have both `app/sitemap.ts` and an `app/sitemap.xml/route.ts` — they collide and the
  build fails. The project already had `src/app/sitemap.ts`, so blog entries were
  added there, reusing the established per-locale `alternates` pattern.

- **Public URLs never leak the backend.** Canonicals, OG tags, JSON-LD, breadcrumbs,
  and sitemap entries are all built with `SITE_URL` (`NEXT_PUBLIC_SITE_URL`), never
  `WORDPRESS_URL`. A test asserts this. Leaking the CMS origin would index the wrong
  domain.

- **WordPress HTML styled without the typography plugin.** `content.rendered` is raw
  HTML; the single-post page styles its children with Tailwind arbitrary variants
  (`[&_h2]:...`, `[&_p]:...`) — no new dependency.

## How it works (data flow)

1. A request hits `/{locale}/blog` (archive) or `/{locale}/blog/{slug}` (post).
2. The page calls `getAllPosts()` / `getPostBySlug()` in `src/lib/wp/client.ts`.
3. Those `fetch` the WordPress REST API at `{WORDPRESS_URL}/wp-json/wp/v2/{WP_POST_TYPE}`
   with `_embed` (inlines featured image + author) and `next: { revalidate: 3600 }`.
4. The page renders the post(s) with `next/image` (media host whitelisted in config),
   injects JSON-LD, and sets canonical/OG metadata pointing at the public site.
5. ISR caches the result for ~1 hour; new posts appear within that window.

## How to extend

- **Change the post type:** set `WP_POST_TYPE` in `.env.local` to the slug you named
  in WP SEO AI (the REST base). Default is `blog`.
- **Instant updates instead of hourly:** add a WordPress `save_post` webhook → a Next
  route that calls `revalidatePath('/[locale]/blog')` and the post path. (Today it's
  pure ISR; `REVALIDATION_SECRET` already exists for this.)
- **Localized content:** thread a `lang` param through `getAllPosts`/`getPostBySlug`
  (append `&lang=` if WP runs WPML/Polylang), and fetch per-locale in the pages.
- **Add categories/tags pages:** follow the same pattern — a new route under
  `(public)/blog/`, a new fetch in `client.ts`, add to the sitemap.

## Dependencies

- **Depends on:** a live, reachable WordPress install with WP SEO AI, the post type
  REST-exposed (`show_in_rest = true`); env vars `WORDPRESS_URL`, `WP_POST_TYPE`,
  `NEXT_PUBLIC_SITE_URL`; existing i18n config (`src/lib/i18n/config.ts`).
- **Depended on by:** `src/app/sitemap.ts` (imports `getAllPosts`).
- **Owned externally:** hosting/securing WordPress itself is the site owner's
  responsibility, not this codebase's.

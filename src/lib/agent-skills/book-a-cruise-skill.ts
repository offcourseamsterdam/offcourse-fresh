/**
 * The one skill this site publishes for Agent Skills Discovery
 * (https://github.com/cloudflare/agent-skills-discovery-rfc). Teaches an
 * agent to actually use the real, already-working /api/v1 + /api/search
 * endpoints — not a hollow description. Kept as a plain string (rather than
 * a file on disk) so the index route can hash exactly the bytes it serves,
 * with no risk of the two drifting apart.
 */
export const BOOK_A_CRUISE_SKILL_MD = `---
name: book-a-cruise
description: Help someone find and book an Off Course Amsterdam canal cruise — list cruises, check pricing, check live availability, and hand off to checkout. Use when a user wants to find, compare, or book an Amsterdam canal/boat tour.
---

# Book an Off Course Amsterdam Cruise

Off Course Amsterdam runs private and shared electric canal cruises in Amsterdam, departing from Brouwersgracht 66 in the Jordaan. This skill uses Off Course's public, read-only API — no API key required, 60 requests/minute per IP.

## 1. List available cruises

\`GET https://offcourseamsterdam.com/api/v1/cruises?locale=en\`

Returns every publicly bookable cruise: slug, title, tagline, price, duration, max guests, and its page URL. \`locale\` is optional (default \`en\`; also \`nl\`, \`de\`, \`fr\`, \`es\`, \`pt\`, \`zh\`).

## 2. Get full detail for one cruise

\`GET https://offcourseamsterdam.com/api/v1/cruises/{slug}?locale=en\`

Returns a Markdown-formatted description, rates per boat/duration, highlights, and FAQs for one cruise.

## 3. Check live availability

\`GET https://offcourseamsterdam.com/api/search/slots?slug={slug}&date={YYYY-MM-DD}&guests={n}\`

Returns the time slots actually open on that date for that many guests. An empty \`slots\` array is explained by \`reasonCode\` (e.g. \`NO_AVAILABILITIES\`, \`TOO_LARGE\`, \`PAST_DATE\`, \`LISTING_NOT_FOUND\`).

## 4. Hand off to checkout

This API is read-only — there is no booking or payment endpoint. Once the guest has picked a cruise, date, and time, send them to the cruise's own page to complete checkout:

\`https://offcourseamsterdam.com/{locale}/cruises/{slug}?date={date}&guests={guests}\`

## Notes

- All prices are in EUR, VAT included.
- Full machine-readable spec: https://offcourseamsterdam.com/openapi.yaml
- Human docs: https://offcourseamsterdam.com/api/v1/docs
- An A2A-compatible agent can call the same two operations as skills over JSON-RPC instead of plain REST — see https://offcourseamsterdam.com/.well-known/agent-card.json
`

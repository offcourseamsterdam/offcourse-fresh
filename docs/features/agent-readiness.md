# AI Agent Readiness & Commerce

## What was built

A set of protocols and endpoints that let AI agents (ChatGPT, Claude, a browser's
in-page assistant, a shopping bot) discover, read, and — for the first time — buy
from Off Course Amsterdam programmatically, instead of only scraping rendered HTML.

Built in response to Cloudflare's Agent Readiness diagnostics
(`dash.cloudflare.com/.../agent-readiness/diagnostics`), validated throughout
against isitagentready.com's scanner and, wherever a feature claimed a live
endpoint existed, against real production data (not just mocks).

Ten items, in build order:

1. **Content-Signal** — declares AI-use preferences in `robots.txt`
2. **Markdown for Agents** — content negotiation serving Markdown instead of HTML
3. **API Catalog (RFC 9727)** + a public read-only REST API
4. **Homepage Link headers** (RFC 8288 / RFC 9727 §3)
5. **A2A Agent Card** + a real Agent-to-Agent JSON-RPC server
6. **Agent Skills Discovery** — a SKILL.md an agent can load
7. **MCP Server Card** + a real Model Context Protocol server
8. **WebMCP** — in-browser tools for a page-embedded agent
9. **DNS-AID** — SVCB records under `_agents` (DNSSEC still pending, see below)
10. **ACP (Agentic Commerce Protocol)** — a real checkout an agent can pay through

Two items were deliberately **not** built, and that's a documented decision, not
a gap: **AP2** (would require Off Course to run its own cryptographic
signing/verification infrastructure — a different order of complexity than
anything else here) and **MPP payment discovery** (would mean publishing a
fabricated payment requirement on API endpoints that are actually free — see
the "Deliberately skipped" section).

## Why this shape

Two recurring principles drove every decision here, because several of these
"standards" turned out to be either very new (spec details changed mid-session
— see MCP below) or invented by the scanner vendor rather than a real
standards body:

- **Never publish a discovery document for a capability that doesn't actually
  work.** A card claiming an A2A/MCP endpoint exists, or an OpenAPI catalog
  pointing at a dead URL, is worse than not publishing anything — it wastes a
  real agent's time and looks like bad faith. Every "card" or "catalog" file
  below points at a route that was built and verified, not stubbed.
- **Verify against real, live data — not just mocks.** Two real bugs were only
  caught this way (see ACP below): FareHarbor's time field turned out to be a
  display string ("11am"), not "14:00", and a private charter's per-rate
  party-size field turned out to mean something completely different from
  what its name suggests. Unit tests with hand-written fixtures would have
  passed both times regardless.

## Key files

### 1. Content-Signal
| File | Purpose |
|---|---|
| [src/app/robots.txt/route.ts](../../src/app/robots.txt/route.ts) | Replaces the old `robots.ts` metadata file — Next's built-in `MetadataRoute.Robots` type has no field for `Content-Signal`, so this hand-builds the same output plus `Content-Signal: search=yes, ai-input=yes, ai-train=yes` |

### 2. Markdown for Agents
| File | Purpose |
|---|---|
| [src/proxy.ts](../../src/proxy.ts) | Rewrites to a Markdown variant when `Accept: text/markdown` is sent, for the homepage, cruise pages, and blog posts |
| [src/lib/markdown/match-agent-route.ts](../../src/lib/markdown/match-agent-route.ts) | Pure path-matching logic (which pages have a Markdown variant) |
| [src/lib/markdown/html-to-markdown.ts](../../src/lib/markdown/html-to-markdown.ts) | Shared HTML→Markdown conversion (turndown) for rich-text fields |
| [src/lib/markdown/build-cruise-markdown.ts](../../src/lib/markdown/build-cruise-markdown.ts), [build-blog-markdown.ts](../../src/lib/markdown/build-blog-markdown.ts), [build-home-markdown.ts](../../src/lib/markdown/build-home-markdown.ts) | Per-page-type Markdown builders |
| [src/app/api/markdown/cruises/[slug]](../../src/app/api/markdown/cruises/%5Bslug%5D/route.ts), [blog/[slug]](../../src/app/api/markdown/blog/%5Bslug%5D/route.ts), [home](../../src/app/api/markdown/home/route.ts) | The routes proxy.ts rewrites to |
| [src/lib/cruise/get-public-cruise-detail.ts](../../src/lib/cruise/get-public-cruise-detail.ts) | Shared data-shaping — same function backs the Markdown route **and** the REST API below |

### 3. API Catalog + public REST API
| File | Purpose |
|---|---|
| [src/app/.well-known/api-catalog/route.ts](../../src/app/.well-known/api-catalog/route.ts) | RFC 9727 linkset pointing at the spec, docs, and status endpoints |
| [public/openapi.yaml](../../public/openapi.yaml) | OpenAPI 3.0 spec for the public API |
| [src/app/api/v1/cruises/route.ts](../../src/app/api/v1/cruises/route.ts), [cruises/[slug]/route.ts](../../src/app/api/v1/cruises/%5Bslug%5D/route.ts) | List/detail JSON, read-only, no API key, 60 req/min |
| [src/app/api/v1/status/route.ts](../../src/app/api/v1/status/route.ts) | Health check (actually pings Supabase) |
| [src/app/api/v1/docs/route.ts](../../src/app/api/v1/docs/route.ts) | Human-readable docs page |
| [src/lib/cruise/get-public-cruise-list.ts](../../src/lib/cruise/get-public-cruise-list.ts) | List-shaping, mirrors get-public-cruise-detail.ts |
| [src/lib/fareharbor/customer-types.ts](../../src/lib/fareharbor/customer-types.ts) | Shared rate-selection/formatting helper (Layer 2 filter) — used by the REST API, Markdown routes, A2A, and MCP |

### 4. Link headers
| File | Purpose |
|---|---|
| [src/lib/agent-discovery/link-header.ts](../../src/lib/agent-discovery/link-header.ts) | Builds the homepage `Link` header (`api-catalog`, `service-desc`, `service-doc`, `describedby`) |

### 5. A2A (Agent-to-Agent)
| File | Purpose |
|---|---|
| [src/app/.well-known/agent-card.json/route.ts](../../src/app/.well-known/agent-card.json/route.ts) | Discovery card |
| [src/app/api/a2a/route.ts](../../src/app/api/a2a/route.ts) | JSON-RPC 2.0 endpoint — `SendMessage`, `GetTask` |
| [src/lib/a2a/skills.ts](../../src/lib/a2a/skills.ts) | The two skills (`list_cruises`, `check_availability`) — shared with MCP |
| [src/lib/a2a/handle-request.ts](../../src/lib/a2a/handle-request.ts) | JSON-RPC dispatch, task lifecycle |
| [src/lib/a2a/task-store.ts](../../src/lib/a2a/task-store.ts) | In-memory task store (fine here — every task completes synchronously within the request; see ACP for why checkout sessions instead needed a real table) |

### 6. Agent Skills Discovery
| File | Purpose |
|---|---|
| [src/app/.well-known/agent-skills/index.json/route.ts](../../src/app/.well-known/agent-skills/index.json/route.ts) | Index — digest computed live from the SKILL.md string so they can never drift apart |
| [src/lib/agent-skills/book-a-cruise-skill.ts](../../src/lib/agent-skills/book-a-cruise-skill.ts) | The skill content — teaches an agent to use the real REST API |

### 7. MCP (Model Context Protocol)
| File | Purpose |
|---|---|
| [src/app/.well-known/mcp/server-card.json/route.ts](../../src/app/.well-known/mcp/server-card.json/route.ts) | Discovery card |
| [src/app/api/mcp/route.ts](../../src/app/api/mcp/route.ts) | Streamable HTTP transport — `initialize`, `tools/list`, `tools/call`, `ping` |
| [src/lib/mcp/handle-request.ts](../../src/lib/mcp/handle-request.ts) | Built against protocol version `2025-06-18` deliberately, **not** the newest `2026-07-28` — see "Judgment calls" below |

### 8. WebMCP
| File | Purpose |
|---|---|
| [src/components/agent/WebMcpTools.tsx](../../src/components/agent/WebMcpTools.tsx) | Mounted in the locale layout; feature-detects `navigator.modelContext`/`document.modelContext` and registers tools |
| [src/lib/webmcp/build-tools.ts](../../src/lib/webmcp/build-tools.ts) | Pure factory — `search_cruises` (triggers the real homepage search, visibly), `get_cruise_details`, `navigate_to_cruise` |

### 9. DNS-AID
No application code — two SVCB records added directly in Cloudflare's DNS
(`_a2a._agents.offcourseamsterdam.com`, `_mcp._agents.offcourseamsterdam.com`,
both pointing at `offcourseamsterdam.com` with `alpn`/`port`). **DNSSEC is not
yet enabled** — Cloudflare's own diagnostic confirms the records are found but
DNSSEC isn't validated. Enabling it needs sequential action at both Cloudflare
(generate a DS record) and Dynadot, the registrar (publish it) — deliberately
left for Beer to do directly rather than automated, since a mismatched DS
record can take the whole domain offline for every DNSSEC-validating
resolver, not just this feature.

### 10. ACP (Agentic Commerce Protocol)
| File | Purpose |
|---|---|
| [supabase/migrations/116_acp_checkout_sessions.sql](../../supabase/migrations/116_acp_checkout_sessions.sql) | New table — a real Supabase-backed store, not in-memory, because create/update/complete can each land on a different serverless instance |
| [src/app/.well-known/acp.json/route.ts](../../src/app/.well-known/acp.json/route.ts) | Discovery document |
| [src/app/api/acp/checkout_sessions/route.ts](../../src/app/api/acp/checkout_sessions/route.ts) + `[id]/route.ts`, `[id]/complete/route.ts`, `[id]/cancel/route.ts` | Full checkout session lifecycle |
| [src/lib/acp/item-id.ts](../../src/lib/acp/item-id.ts) | Encodes `(slug, date, availPk, customerTypeRatePk)` into an opaque item id — **see the FareHarbor pitfalls below**, this file was rewritten once after live testing |
| [src/lib/acp/resolve-checkout-items.ts](../../src/lib/acp/resolve-checkout-items.ts) | Re-verifies live FareHarbor availability and prices every checkout — never trusts a stored snapshot |
| [src/lib/acp/build-payment-intent-metadata.ts](../../src/lib/acp/build-payment-intent-metadata.ts) | Builds the **exact** metadata schema `create-intent.ts` already uses, so the existing Stripe webhook can finalize an ACP-originated payment with zero new booking logic |
| [src/lib/acp/mark-session-completed.ts](../../src/lib/acp/mark-session-completed.ts) | The one additive hook in the existing webhook (`src/app/api/webhooks/stripe/route.ts`) — flips an ACP session to `completed` once the real booking exists |

## Architecture decisions (non-obvious ones)

**One shared cruise/skill layer, four surfaces on top of it.** `get-public-cruise-detail.ts`,
`get-public-cruise-list.ts`, and `customer-types.ts` are each used by 2–4 of these
features (Markdown, REST API, A2A, MCP). A2A's `skills.ts` is imported directly by
MCP rather than reimplemented — MCP "tools" and A2A "skills" are the same concept
under two different protocol names. This is the main reason ten separate protocol
integrations added a manageable amount of code rather than ten independent stacks.

**Every discovery document is honest about what's live.** No card advertises
`streaming`, `pushNotifications`, or an unimplemented method — capabilities objects
list exactly what the corresponding route actually does.

**ACP hands payment finalization to the existing webhook, not a new booking path.**
This codebase already had one hardened, exactly-once booking finalizer (a `UNIQUE`
constraint on `bookings.stripe_payment_intent_id` — a per-payment claim-mutex table
existed once and was deliberately dropped in favor of this simpler constraint, per
migration 085's own comment). Building a second, ACP-specific booking-creation path
would have risked reintroducing exactly the double-booking bug class that migration
fixed. Instead, ACP's `/complete` route creates a real Stripe PaymentIntent carrying
the same metadata shape `create-intent.ts` already produces, and one small additive
call (`markAcpSessionCompleted`) was added to the webhook's existing success path.

**Pricing correctness: private charters are a flat rate, shared cruises are
per-person.** `resolve-checkout-items.ts` gets this right in two different, easy-to-blur
ways: the boat rate itself doesn't multiply by guest count for private charters (it's
one flat price regardless of headcount), and separately, FareHarbor's own
`minimumParty`/`maximumParty` field on a private rate is **not** a guest-count bound at
all — live testing showed it's always reported as `1`/`1` (bounding "how many of this
line item", i.e. always one boat). Guest count for a private charter is validated
against the listing's own `max_guests` instead. Both of these are regression tests,
not just code comments, because both were only caught by testing against real
FareHarbor data — hand-written test fixtures had both wrong the first time.

## Judgment calls and deliberately narrow scope

- **MCP targets protocol version `2025-06-18`, not the newest `2026-07-28`.**
  Mid-implementation, research surfaced that MCP had overhauled its versioning
  model two months earlier (no more `initialize` handshake; a new `server/discover`
  RPC). No precise, verified schema for that new RPC could be found — only a
  narrative description. Rather than guess and ship something subtly broken, this
  server targets the older, stable, still-universally-deployed handshake. Per MCP's
  own compatibility matrix, a modern client talking to this "legacy" server still
  works. Revisit if/when `server/discover`'s exact shape can be verified.
- **ACP's `/complete` route does not handle 3D Secure / SCA.** If Stripe requires
  additional authentication on a charge (possible even with a Shared Payment Token,
  since Off Course is EU-based), the route reports `authentication_required` and
  rejects the request outright, rather than attempting a buyer hand-off mid-flow.
- **The Stripe key needs one specific permission for ACP to actually charge:**
  "Shared Payment Tokens → Read" on the restricted key in `STRIPE_SECRET_KEY`. This
  was missing initially — confirmed via a live (safe, fake-token) test that returned
  "Permission denied" — and has since been enabled directly in the Stripe Dashboard.
  A follow-up "no such token" error confirmed the fix worked.
- **AP2 (Agent Payments Protocol) — deliberately not built.** A real AP2 "merchant"
  role requires Off Course to run its own cryptographic signing/verification
  infrastructure (merchant-signed JWTs, mandate verification, dispute-evidence
  receipts) — a fundamentally different scope than ACP, which delegates all of that
  to Stripe. Given ACP already provides a real, working agent-payment path, this was
  scoped as a possible future project rather than same-session work.
- **MPP payment discovery — deliberately not built.** MPP documents API endpoints
  that charge AI agents per call via HTTP 402. Off Course's public API is
  deliberately free (an earlier, explicit decision), and its one real payment
  surface (ACP checkout) is a full ticket purchase, not a per-call micropayment.
  Publishing `x-payment-info` metadata here would mean asserting a payment
  requirement that doesn't exist — actively wrong information on a discovery
  surface an agent might actually act on.

## How to extend

**Add a new A2A skill / MCP tool:** add one entry to `SKILL_IDS` and a case in
`runSkill()` in `src/lib/a2a/skills.ts`, then add the matching descriptor (with a
JSON Schema `inputSchema`) to `src/lib/mcp/tools.ts`. Both protocols call the same
`runSkill()` — no duplicate business logic needed.

**Add a new Markdown-negotiated page type:** add a case to
`matchMarkdownRoute()` in `src/lib/markdown/match-agent-route.ts`, and a
`src/app/api/markdown/{type}/route.ts` that builds the Markdown (reuse
`html-to-markdown.ts` for any rich-text field).

**Add a new public REST endpoint:** put it under `src/app/api/v1/`, reuse
`enforceRateLimit()` (60/min is the established convention here), and add its
schema to `public/openapi.yaml`.

## Dependencies

- **Depends on:** the existing FareHarbor availability/booking pipeline
  (`src/lib/fareharbor/`), the existing Stripe booking flow
  (`src/lib/booking/calculate-quote.ts`, `create-intent.ts`), and the existing
  Stripe webhook as the sole booking finalizer.
- **Depended on by:** nothing yet inside this codebase — these are new,
  additive entry points. The webhook edit (`markAcpSessionCompleted`) is the
  one place existing code was modified, and it's a no-op for every
  non-ACP payment.
- **External:** `turndown` (new dependency, HTML→Markdown), Stripe's Shared
  Payment Token feature (needs the permission above enabled on the API key
  used in `STRIPE_SECRET_KEY`).

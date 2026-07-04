# Storage / Stock agent — QR count → low-stock → supplier reorder email

The second operational agent. Staff scan **one QR** stuck in the storage room,
tap **− / +** for each item on their phone, and submit. When an item drops to or
below its reorder threshold, the Ghost drafts a **supplier reorder email** per
supplier as a shadow proposal. A human approves & sends it from the Ghost
dashboard — the same draft → approve → send path as maintenance (a reorder email
is correctable, **never auto-sent**).

## What was built

- A **stock catalog** (`stock_items`): each item carries its current count and a
  per-item reorder rule ("2 left → reorder 5"), counting unit, optional **pack
  size** (a wine box = 12 bottles, a beer tray = 24 cans), location, and supplier.
  You count in trays/boxes; `pack_size`/`pack_unit` give the bottle-equivalent and
  make the supplier email precise ("2 boxes — 12 bottles each").
- A **public, token-gated QR form** (`/[locale]/stock/[token]`) — no login; the
  HMAC token is the auth (same posture as the extras-upsell page). Tap −/+ or
  type, submit.
- An **admin board** (`/admin/stock`) — manage items, see the printable QR, see
  what's low, edit counts inline.
- The **Ghost stock drafter** (`draftStockReorders`) — groups low items by
  supplier and drafts one reorder email each (metered, skip-first, deduped).
- A **`stock_reorder` Ghost proposal** + card on `/admin/ghost` with one-click
  **Approve & send** (reuses the maintenance send path).

## Key files

| File | Role |
|------|------|
| `supabase/migrations/079_stock.sql` | `stock_items` table (RLS-on, no policies) |
| `src/lib/stock/stock-token.ts` | HMAC token for the QR link (mirrors `extras-token.ts`); `STOCK_TOKEN_SECRET` |
| `src/lib/ghost/stock-drafter.ts` | `draftStockReorders()` — find low items → group by supplier → metered Claude draft → shadow proposal |
| `src/app/api/admin/stock/route.ts` | board GET (+ QR url) + POST/PATCH/DELETE (all `requireAdmin`) |
| `src/app/api/stock/count/route.ts` | **public**, token-gated POST — saves counts, triggers the drafter in `after()` |
| `src/app/[locale]/admin/stock/page.tsx` | the admin board + QR (`qrcode.react`) |
| `src/app/[locale]/(public)/stock/[token]/page.tsx` + `StockCountClient.tsx` | the public QR form |
| `src/app/api/admin/ghost/proposals/[id]/route.ts` | `send` action extended to `stock_reorder` |
| `src/lib/ghost/agents.ts` | storage agent flipped `planned → active`; kind renamed `stock_order → stock_reorder` |
| `src/app/[locale]/admin/ghost/page.tsx` | `stock_reorder` card |

## How it works

1. **Count.** Staff scan the QR → `/[locale]/stock/[token]`. The server page
   validates the token (`isValidStockToken`) → `notFound()` on a bad token, else
   loads active items and renders the −/+ form. Submit POSTs to
   `/api/stock/count` with `{ token, counts }`; the route re-checks the token,
   writes `current_count` + `last_counted_at` + `counted_via='qr'`, and runs the
   drafter in `after()` so the phone gets its 200 immediately.
2. **Find low.** `draftStockReorders()` reads active items and keeps those with
   `reorder_threshold > 0 && current_count <= reorder_threshold`. **Skip-first:**
   nothing low → no AI call at all.
3. **Group + dedupe.** Low items are grouped by supplier (per-item
   `supplier_email`, else name, else a `__none__` bucket → `STOCK_EMAIL_RECIPIENT`).
   A supplier already drafted in the last 3 days is skipped (no re-spam while the
   stock is still in transit).
4. **Draft.** One metered Claude call per supplier writes a friendly reorder
   email; a `stock_reorder` `agent_proposals` row (status `shadow`) carries
   `{ supplier_key, recipient, urgency, item_ids, items, email_subject, email_body }`.
   `urgency` is `urgent` when any item is at 0.
5. **Approve & send.** On the Ghost dashboard the card shows the items + the
   drafted email with a two-step **Approve & send email** button. The shared
   `send` action atomically claims `shadow→sending`, sends via Resend, marks
   `executed`, stamps `stock_items.last_reordered_at` for the ordered items, and
   posts a Slack confirmation — releasing the claim on any failure.

## Architecture decisions (non-obvious)

- **One QR, not per-box.** The token signs a fixed scope string (no per-row id),
  so a single printed QR opens the whole list grouped by `location`. Rotating
  `STOCK_TOKEN_SECRET` invalidates printed QRs.
- **Per-supplier email, not per-item.** Low items are consolidated into one email
  per supplier (fewer, clearer emails). Dedupe is per supplier (`supplier_key`),
  not per item or per date.
- **No second board table.** Unlike maintenance (`maintenance_tasks`), the
  durable state here is `stock_items` itself (the counts). The reorder is just an
  `agent_proposals` row; `stock_items.last_reordered_at` records that an order
  went out.
- **Reuses the maintenance send path.** `sendMaintenanceEmail` is generic
  (`recipient/subject/body`); the proposals `send` action now accepts both
  `maintenance_task` and `stock_reorder`, branching only on the env-var fallback
  and which board record it stamps.

## Shadow AI / Ghost rule decision

- **Ghostable?** Yes — this *is* the storage agent (previously `planned`). New
  kind `stock_reorder` owned by the `storage` agent; event-triggered drafter
  (a count submission); a card on `/admin/ghost`.
- **Money / irreversible?** A supplier *reorder request* email is correctable,
  not money-moving — so `stock_reorder` is **not** in `IRREVERSIBLE_KINDS`; its
  autonomy ceiling is `ask` (a human click sends it). It is **never auto-sent**.
- **Drinks note.** Drinks *sales* stay out of scope (PayPal on the boat). This
  agent only *counts drink stock* to reorder it — consistent with "general stock,
  manual reorders".

## Setup (what the operator must do)

1. Set `STOCK_TOKEN_SECRET` (any long random string — signs the QR link) and
   `STOCK_EMAIL_RECIPIENT` (a fallback supplier email; each item can override it
   with its own `supplier_email`).
2. Add stock items in `/admin/stock` with their reorder thresholds and suppliers.
3. Print the QR shown on `/admin/stock` and stick it in the storage room.

## Tests

- `src/lib/stock/stock-token.test.ts` — token round-trip, bad/empty token,
  URL shape, secret rotation (4 tests).
- `src/lib/ghost/stock-drafter.test.ts` — skip-first (nothing low, untracked
  item), happy-path payload, supplier grouping, multi-supplier split, dedupe,
  env-fallback recipient, malformed output, error swallow (9 tests).

## How to extend

- **Daily backstop cron:** call `draftStockReorders()` from an ops cron so low
  stock surfaces even without a fresh count.
- **Per-location QRs:** sign the location id into the token and filter items by it.
- **Slack text input** ("3 ice tea"): a second count path feeding the same
  `stock_items` update + drafter (the QR form was chosen first for zero-typing).

## Dependencies

- **Depends on:** the Ghost shadow framework (`agent_proposals`, autonomy ladder,
  metering), Resend, `qrcode.react`, the extras-style HMAC token pattern.
- **Depended on by:** nothing yet.

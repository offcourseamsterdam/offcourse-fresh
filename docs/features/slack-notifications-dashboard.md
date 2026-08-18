# Slack Notifications Dashboard

**Track:** F (Operations) · **Status:** done

## What was built

Two things that did not exist before:

1. **A log of every Slack message the site sends.** Slack notifications used to be
   fire-and-forget — the app shouted into a channel and kept no record. If Slack was down,
   or the webhook URL was wrong, or nobody was looking at the channel that afternoon, the
   message was simply gone. Every send is now written to a `slack_notifications` table
   first, so the admin dashboard can show what the site has been telling you.

2. **A catalog of every notification type.** All ~30 kinds of message the app can send are
   now declared in one file with a plain-English "fires when" and "what to do". The admin
   page renders that file directly, so it is documentation that cannot drift out of date.

In the admin panel, under **Operations → Notifications**:

- `/admin/notifications` — the recent feed. Pick a window (24h / 7 / 30 / 90 days), filter
  by type, read each message exactly as Slack received it. Failed sends are flagged in red.
- `/admin/notifications/types` — the clickthrough from the feed: every notification type,
  grouped by category, searchable, with what sets it off and what to do about it.

## Key files

| File | What it does |
|------|--------------|
| `src/lib/slack/notification-types.ts` | **The catalog.** One entry per notification type. Source of truth for the `kind` union type, the DB tag, and the docs page. Dependency-free so the browser can import it. |
| `src/lib/slack/send-notification.ts` | `postSlackText` / `postSlackDM` / `postSlackCritical` — now take a required `kind` and log every send. |
| `src/lib/slack/log-notification.ts` | Writes one row to `slack_notifications`. Server-only, never throws. |
| `src/app/api/admin/notifications/route.ts` | `GET` — the feed + per-kind counts. `requireAdmin()` guarded. |
| `src/app/[locale]/admin/notifications/page.tsx` | The recent-notifications feed. |
| `src/app/[locale]/admin/notifications/types/page.tsx` | The notification-type catalog page. |
| `src/app/[locale]/admin/notifications/badges.tsx` | Severity / category / destination chips shared by both pages. |
| `supabase/migrations/108_slack_notifications.sql` | The log table + indexes + RLS. |
| `src/lib/slack/notification-types.test.ts` | Catalog guardrail (see below). |
| `src/lib/slack/send-notification.test.ts` | Logging behaviour: log once, log failures, never throw. |
| `src/app/api/admin/notifications/route.test.ts` | Auth gate, window clamping, counts-over-window. |

Every one of the ~34 `postSlack*` call sites across the codebase was updated to pass its
`kind`.

## Architecture decisions

### `kind` is a required, typed parameter — not an optional tag

`postSlackText(text, kind)` takes the kind as a **required** argument whose type is the union
of every kind in the catalog. That means a typo (`'booking.creted'`) or an uncatalogued kind is
a **compile error**, not a mystery row in the database. The alternative — inferring the type by
pattern-matching the message text — would have been fragile the first time someone reworded a
message.

This is the same idea as the admin-route auth contract: make the guardrail something the
compiler or the test suite enforces, rather than something a human has to remember.

### The catalog is code, not a database table

Notification types could have lived in a `slack_notification_types` table with an admin CRUD
screen. They don't, because a notification type is not data — it's a thing the code does. A row
in a table can describe an alert that no longer exists, and nothing would notice. A TypeScript
array can't: `notification-types.test.ts` scans the whole `src/` tree and fails if a catalogued
kind is never sent anywhere. Add a notification, add a catalog entry, and the docs page updates
itself.

### The log stores the full message text, and the table has no anon RLS policy

The dashboard shows each message verbatim rather than a truncated preview, because a "CRITICAL:
booking not saved" alert is only useful if you can read the payload. That means the table holds
customer names, emails, phone numbers and Stripe payment intent ids — so it ships with RLS
enabled and **no** policy for `anon`/`authenticated`. Only the service-role client (the logger,
and the `requireAdmin()`-guarded read route) can touch it.

### Logging is settled after the send, and can never break the caller

Inside each sender the Slack post is resolved **first**, then logged exactly once:

```ts
let error: string | null = null
try { /* post to Slack */ } catch (err) { error = ... }
await logSlackNotification({ ..., status: error ? 'failed' : 'sent', error })
  .catch(() => { /* best-effort */ })
```

Logging inside the `try` would let a failing database write be caught as if the *Slack post*
had failed — writing a second, wrong "failed" row for a message that actually went out. And
the `.catch()` matters because these senders run inside the paid-booking path: a cruise must
never fail to book because a log row didn't save.

`postSlackCritical` (DM first, channel fallback) logs **both** attempts when the DM is
rejected — the dashboard should show the DM failing, not just the fallback quietly succeeding.

### Counts are computed over the window, not over the page

The feed is capped (default 100 rows). The per-kind filter chips query the window separately,
so "booking.created (43)" means 43 in the last 7 days — not "43 of the ones that fit on this
page". When the page *is* capped, the UI says so rather than implying it showed everything.

## How it works

```
something happens (payment, cron, catering, chargeback…)
        │
        ▼
postSlackText(message, 'booking.created')      ← kind is required & type-checked
        │
        ├──► POST to Slack webhook / chat.postMessage
        │
        └──► logSlackNotification({ kind, destination, text, status, error })
                     │
                     ▼
             slack_notifications table
                     │
                     ▼
   GET /api/admin/notifications  (requireAdmin)
                     │
                     ▼
   /admin/notifications  ──clickthrough──►  /admin/notifications/types
   (what was sent)                          (what each type means)
```

## How to extend

**Adding a new notification:**

1. Add an entry to `SLACK_NOTIFICATION_TYPES` in `src/lib/slack/notification-types.ts` —
   pick a `domain.event` kind, a category, a severity, and write the `trigger` / `action` in
   plain English (these render on the admin page verbatim, so write them for a human at 7am).
2. Call `postSlackText(message, 'your.kind')` wherever it fires.

That's it — the feed groups it, the filter chips pick it up, and the types page documents it.
There is no migration, no seed row, and nothing to register.

**Removing a notification:** delete the call site *and* the catalog entry. Forgetting the
second half fails `notification-types.test.ts` ("every catalogued kind is actually sent
somewhere in the codebase").

**Retention:** nothing prunes this table yet. At current volumes that's fine for years, but if
it ever gets heavy, a `delete from slack_notifications where created_at < now() - interval '1
year'` in a cron is the obvious move.

## Dependencies

**Depends on:** `slack_notifications` table (migration 108) · `createAdminClient()` ·
`requireAdmin()` · `useAdminFetch`.

**Depended on by:** every Slack-sending path in the app — the Stripe webhook, the admin
booking flow, booking cancel/rebook, the `pending-fh-sweep` and `fh-consistency` crons, catering
notifications, the cron failure alerter, the Google Ads guardrail, and the WhatsApp click
tracker. A change to the `postSlack*` signatures touches all of them.

## Notes for whoever picks this up next

- `docs/implementation-plan.md` §3.1 sketched a `slack_notifications` table with
  `message_type` / `payload jsonb` / `sent_at`. Migration 108 supersedes that sketch with the
  shape the code actually needs (`kind` / `text` / `destination` / `status`); the plan's version
  was never built.
- There are two **orphan** tables in the database from that older plan — `slack_message_log`
  and `slack_notification_settings`. Nothing in the codebase reads or writes either one. They
  were left alone rather than dropped (dropping a table in prod is not a thing to do in
  passing), but they are cleanup candidates.
- Track H (`docs/tracks/track-h-slack.md`) step **H5** — per-type on/off toggles and a "send a
  test notification" button — is not built. The catalog is the natural place to hang it: add an
  `enabled` lookup keyed by `kind` and check it in `postSlackText`.

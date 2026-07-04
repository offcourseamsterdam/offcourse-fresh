# Notification Center — every Slack message this app sends & receives

A single admin surface (`/admin/notifications`, under **Dev**) that catalogs
every Slack notification the app produces or consumes, logs each one as it
fires, and lets you enable/disable individual types. Built so the team can see —
at a glance — what goes to Slack, when, and to whom, and manage it from one place.

## What was built

- A **catalog** of every Slack notification (`src/lib/slack/catalog.ts`):
  ~28 entries across booking, payment, catering, operations, alerts, marketing,
  AI, integrations, and inbound, each with its trigger, direction, channel, and
  severity.
- A **message log** (`slack_message_log`) — every outbound send and inbound
  event is recorded (type, direction, channel, preview, trigger, time).
- **Per-type toggles** (`slack_notification_settings`) — enable/disable intent
  stored per catalog id.
- An **admin page** with a config-health bar (which Slack env vars are set), a
  filterable catalog, and a live "recent sends" log.

## Key files

| File | Role |
|------|------|
| `supabase/migrations/078_notifications.sql` | `slack_notification_settings` + `slack_message_log` (RLS-on, no policies) |
| `src/lib/slack/catalog.ts` | the static catalog of every notification type + category metadata |
| `src/lib/slack/log.ts` | `logSlackMessage()` — fire-and-forget insert into `slack_message_log` |
| `src/lib/slack/send-notification.ts` | `postSlackText(text, opts?)` now logs every webhook send |
| `src/lib/slack/bot.ts` | `postToChannel` / `postDm` now log every bot send |
| `src/app/api/admin/notifications/route.ts` | GET (catalog + settings + log + env health) + PATCH (toggle) |
| `src/app/[locale]/admin/notifications/page.tsx` | the admin UI |

## How it works

- Every Slack helper (`postSlackText`, `postToChannel`, `postDm`) takes an
  optional `{ type, triggeredBy }` and logs the send to `slack_message_log`
  before dispatch (best-effort, never blocks the request). Call sites pass the
  catalog `id` as `type` so the log lines map back to the catalog.
- The admin page reads the catalog (static), the per-type settings, the last 100
  log rows, and which `SLACK_*` env vars are configured, and renders a
  filterable table + a live log tab.
- Toggling records intent in `slack_notification_settings`. Enforcement at each
  send site is rolled out progressively (the toggle is the source of truth; not
  every sender consults it yet).

## Architecture decisions (non-obvious)

- **Named `slack_*` to avoid a collision.** A `notification_settings` table
  already existed (partner booking-notification prefs). The new tables are
  `slack_notification_settings` and `slack_message_log` so they never clash.
- **Catalog is code, not data.** The list of notification *types* is a static
  TypeScript array (they're defined by code paths, not user data). Only the
  toggles and the log live in the database.
- **Logging is best-effort.** `logSlackMessage` swallows all errors — a logging
  failure must never affect the request that triggered the Slack message.

## Inbound

The catalog also documents the two inbound Slack paths: the captain
`/checkin` `/checkout` slash commands and the maintenance-channel intake.

## Dependencies

- **Depends on:** the existing Slack helpers + webhook/bot config.
- **Depended on by:** nothing; new senders should pass a catalog `type` so they
  show up in the log.

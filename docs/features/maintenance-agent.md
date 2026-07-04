# Maintenance Agent — Slack → triage → photo-describe → technician email

The first of the two planned operational agents (maintenance + storage). People
post in a Slack **"Maintenance and Ideas"** channel — text and/or photos. The
Ghost reads each post, assigns a **priority** (essential / cosmetic / wishlist),
**describes any photos** (Gemini), and **drafts a quote-request email** to the technician.
The email is **never auto-sent**: it sits as a shadow proposal until a human taps
**Approve & send** — the same draft → approve → act pattern as catering and
booking.

## What was built

- A Slack Events intake (`/api/slack/events`) that hands maintenance-channel
  posts to a shadow drafter.
- A shadow drafter (`draftMaintenanceTask`) that assigns a priority, describes
  photos, and drafts the technician email — metered, skip-first, error-swallowing.
- A durable board record (`maintenance_tasks`) + a Ghost email proposal
  (`agent_proposals` kind `maintenance_task`, status `shadow`).
- A human-approved **send** action (one click, atomic claim) on the Ghost
  proposals route — the only outward action.
- An admin board at `/admin/maintenance` and a card on the `/admin/ghost`
  ops dashboard.

## Key files

| File | Role |
|------|------|
| `supabase/migrations/077_maintenance.sql` | `maintenance_tasks` table (RLS-on, no policies) + adds the `'sending'` transient claim status to `agent_proposals` |
| `src/lib/ghost/maintenance-drafter.ts` | `draftMaintenanceTask(input)` — classify + photo-describe + draft email; writes the board record and the shadow proposal |
| `src/lib/ai/describe-image.ts` | `describeImageWithGemini()` — generic, **metered** Gemini vision (+ `fetchImageAsBase64` with optional auth headers) |
| `src/app/api/slack/events/route.ts` | Slack Events endpoint — verifies signature, acks fast, runs the drafter in `after()` |
| `src/lib/maintenance/send-email.ts` | `sendMaintenanceEmail()` — dispatches the drafted email via the shared Resend sender |
| `src/app/api/admin/ghost/proposals/[id]/route.ts` | new `send` action — atomic claim `shadow→sending→executed`, release on failure |
| `src/app/api/admin/maintenance/route.ts` | board GET + status PATCH (both `requireAdmin`) |
| `src/app/[locale]/admin/maintenance/page.tsx` | the board UI |
| `src/app/[locale]/admin/ghost/page.tsx` | `maintenance_task` card + Approve & send |
| `src/lib/ghost/agents.ts` | maintenance agent flipped `planned → active` |

## How it works

1. **Intake.** Someone posts in the Slack channel. Slack POSTs `/api/slack/events`.
   The route verifies the signature, handles the one-time `url_verification`
   handshake, drops Slack retries (we ack fast, so a retry is a duplicate), and —
   for a genuine human `message` in `SLACK_MAINTENANCE_CHANNEL_ID` (no `bot_id`;
   subtype must be absent **or** `file_share`, which is how Slack delivers a photo
   upload) — fetches any image files (from `*.slack.com` only, with the bot token)
   and calls `draftMaintenanceTask` in `after()` so Slack still gets its sub-3-second
   200. The intake rule is the pure, unit-tested `extractMaintenanceEvent`.
2. **Photo → words.** Each image is described by `describeImageWithGemini`
   (Gemini 2.5 Flash), metered via `recordAiUsage` (Gemini pricing was added to
   the cost meter — the pre-existing SEO `describeWithGemini` is unmetered and
   left alone).
3. **Triage + draft.** One metered Claude call returns the priority
   (essential / cosmetic / wishlist), a clean title + summary, an optional boat,
   and the technician email (subject + body).
4. **Write.** A `maintenance_tasks` row (the board record) and a
   `maintenance_task` `agent_proposals` row (status `shadow`, carrying the email
   draft) are written; the task is linked to its proposal.
5. **Approve & send.** On the Ghost ops dashboard the card shows the
   priority, photo read-outs, and the drafted email with a two-step
   **Approve & send email** button → POST `{ action: 'send' }`. The route
   atomically claims `shadow→sending` (a second click gets zero rows and aborts),
   sends via Resend, marks `executed`, stamps the board record, and posts a Slack
   confirmation — releasing the claim back to `shadow` on any failure.

## Architecture decisions (non-obvious)

- **Event-triggered, not cron.** Unlike the catering/schedule drafters (daily
  cron), maintenance fires off a Slack post — so it lives in its own
  `maintenance-drafter.ts` (like the inbox `shadow-drafter`), not in
  `ops-drafters.ts`. Dedupe is **per Slack event id** (unique index on
  `source_slack_event_id`), not per date.
- **Two objects, on purpose.** The `maintenance_tasks` row is the durable board
  item with its own lifecycle (open → in_progress → done / dismissed); the
  `agent_proposals` row is the Ghost email action (shadow → executed). The board
  manages status; the Ghost card sends the email — one send path, no double-send
  surface.
- **Metered Gemini.** Reading photos with Gemini required adding a
  `gemini-2.5-flash` pricing row to `src/lib/ai/usage.ts`; an unmetered AI call is
  invisible spend (CLAUDE.md). The new `describeImageWithGemini` always meters.
- **`'sending'` claim status.** Migration 077 extends the `agent_proposals`
  status CHECK with `'sending'`, mirroring the booking `'booking'` claim
  (migration 076) — the atomic-claim guard would otherwise violate the
  constraint and 500.
- **Photos for v1.** Slack photos are described (the words go in the email) and
  the Slack permalink is stored in `photo_urls` (clickable for the team). Re-hosting
  the image to the public bucket for inline rendering / email attachment is a
  deferred enhancement (would touch the `image_assets` context enum).

## Shadow AI / Ghost rule decision

- **Ghostable?** Yes — this *is* the maintenance agent (previously `planned`).
  New kind `maintenance_task` owned by the `maintenance` agent; event-triggered
  shadow drafter; a card on `/admin/ghost`.
- **Money / irreversible?** A technician *quote-request* email is correctable,
  not money-moving — so `maintenance_task` is **not** in `IRREVERSIBLE_KINDS`; its
  autonomy ceiling is `ask` (a human click sends it). It is **never auto-sent**;
  the send is the one outward action and only fires on an explicit click, through
  the guarded proposals route.

## Setup (what the operator must do)

1. In the existing Slack app, enable the **Events API** with request URL
   `https://<site>/api/slack/events` and subscribe to `message.channels`
   (or `message.groups` for a private channel).
2. Add the bot to the "Maintenance and Ideas" channel; grant `channels:history`
   (or `groups:history`) + `files:read`.
3. Set `SLACK_MAINTENANCE_CHANNEL_ID` (the channel id) and
   `MAINTENANCE_EMAIL_RECIPIENT` (the technician's email). Until both are set the
   intake is dark and the send action returns a clear "configure the recipient"
   error.

## How to extend

- **More signal sources** (engine-hour thresholds, recurring service intervals):
  add a cron that calls `draftMaintenanceTask` with `source: 'admin'` and a
  synthetic event id — the drafter is source-agnostic.
- **Render the actual photos:** upload Slack files to the `cruise-images` bucket
  via `createPendingAsset` (needs a maintenance `image_assets` context) and store
  public URLs in `photo_urls`.
- **Storage agent** (the second planned agent) reuses the same Slack intake +
  draft → approve → send machinery for supplier reorders.

## Tests

- `src/lib/ghost/maintenance-drafter.test.ts` — skip-first (no text/photo,
  dedupe), happy path (board + shadow proposal shapes, boat mapping), photo
  description capture + one-bad-photo resilience, malformed/invalid output,
  task-insert conflict, error swallowing (9 tests).
- `src/app/api/admin/ghost/proposals/[id]/route.test.ts` — the `send` action:
  claim → send → executed + board stamp, already-executed / wrong-kind /
  no-draft / no-recipient guards, lost atomic claim, release-on-failure (7 tests).

## Dependencies

- **Depends on:** the Ghost shadow framework (`agent_proposals`, autonomy ladder,
  metering), the existing Slack app (bot token + signing secret), Resend, Gemini.
- **Depended on by:** nothing yet; the storage agent will follow the same pattern.

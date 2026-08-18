-- Sent-Slack-notification log.
--
-- Slack messages were fire-and-forget: once posted, the only record was the Slack
-- channel itself. That made "what did the system tell us this week?" unanswerable
-- from the admin dashboard, and made a silently-broken webhook invisible.
--
-- Every message postSlackText / postSlackDM / postSlackCritical sends is now written
-- here, tagged with its `kind` from src/lib/slack/notification-types.ts. The admin
-- Operations → Notifications page reads this table.
--
-- Writing here is best-effort: a failure to log must never break a booking, so
-- src/lib/slack/log-notification.ts swallows its own errors.
create table if not exists slack_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Machine id from the catalog, e.g. 'booking.created'. Text (not an enum) so a
  -- new notification type never needs a migration; the catalog is the source of truth.
  kind text not null,
  -- 'channel' (shared alerts webhook) or 'dm' (chat.postMessage to a user/DM).
  destination text not null default 'channel',
  -- Slack channel or user id for DMs; null for the shared webhook.
  channel text,
  -- The exact message body that was posted, so the dashboard can show it verbatim.
  text text not null,
  -- 'sent' | 'failed'. Failures are kept: a Slack outage is exactly when you want a record.
  status text not null default 'sent',
  error text
);

-- The dashboard's two queries: newest-first feed, and newest-first within one kind.
create index if not exists slack_notifications_created_at_idx
  on slack_notifications (created_at desc);
create index if not exists slack_notifications_kind_created_at_idx
  on slack_notifications (kind, created_at desc);

alter table slack_notifications enable row level security;
-- No policy for anon/authenticated on purpose: these messages contain customer
-- names, emails, phone numbers and payment intent ids. Only the service-role
-- client (the logger, and the requireAdmin()-guarded read route) can touch it.

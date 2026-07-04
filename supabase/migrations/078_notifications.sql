-- Notification Center: per-type enable/disable settings (keyed by catalog ID).
-- Named slack_* to avoid the pre-existing partner `notification_settings` table.
CREATE TABLE public.slack_notification_settings (
  id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.slack_notification_settings ENABLE ROW LEVEL SECURITY;

-- Log of every Slack message sent or received
CREATE TABLE public.slack_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text,
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  channel text,
  recipient_type text CHECK (recipient_type IN ('webhook', 'channel', 'dm', 'command')),
  message_preview text,
  triggered_by text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slack_message_log_sent_at_idx ON public.slack_message_log (sent_at DESC);
CREATE INDEX slack_message_log_type_idx ON public.slack_message_log (notification_type, sent_at DESC);
ALTER TABLE public.slack_message_log ENABLE ROW LEVEL SECURITY;

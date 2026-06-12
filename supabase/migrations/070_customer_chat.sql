-- Customer chat / unified inbox — phase 1 (webchat only).
-- See docs/plans/unified-inbox-and-comms.md §3. The schema is channel-agnostic
-- on purpose: email/WhatsApp/voice later are new rows, not new tables.
--
-- Posture: RLS ON with NO policies (same as bookings/staff) — all access goes
-- through API routes using the service-role client. The public widget
-- authenticates with the conversation's webchat_token (a URL secret, same
-- pattern as staff.calendar_token).

-- ============================================================
-- contacts — one row per human, across all channels.
-- Email and phone are each unique so the same person converges on one
-- contact no matter which door they walk in through.
-- ============================================================
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NULL UNIQUE,
  phone_e164 text NULL UNIQUE,
  locale text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- conversations — one thread with one contact on one channel.
-- ============================================================
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('webchat', 'email', 'whatsapp', 'voice')),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  subject text NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
  assignee_profile_id uuid NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- The widget's bearer secret: knowing the token = owning the conversation.
  webchat_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  -- Inbound messages the admin hasn't seen yet (badge + unread dot).
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE INDEX conversations_status_last_message_idx
  ON public.conversations (status, last_message_at DESC);
CREATE INDEX conversations_contact_idx ON public.conversations (contact_id);

-- ============================================================
-- messages — everything inside a thread, including internal notes.
-- direction: 'in' = customer → us, 'out' = us → customer,
--            'note' = internal, never delivered anywhere.
-- provider_message_id is the cross-channel idempotency key (Gmail message
-- id, Twilio MessageSid…); webchat doesn't need it, later channels do.
-- ============================================================
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out', 'note')),
  body text NOT NULL,
  author_name text NULL,
  provider text NOT NULL DEFAULT 'webchat',
  provider_message_id text NULL UNIQUE,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX messages_conversation_created_idx
  ON public.messages (conversation_id, created_at);

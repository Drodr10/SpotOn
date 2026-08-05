-- Persist push notification send attempts so webhook retries and scheduler
-- overlaps do not send duplicate phone notifications.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sent',
  title text,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_events_reservation
  ON public.notification_events(reservation_id);

CREATE INDEX IF NOT EXISTS idx_notification_events_event_key
  ON public.notification_events(event_key);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

COMMIT;

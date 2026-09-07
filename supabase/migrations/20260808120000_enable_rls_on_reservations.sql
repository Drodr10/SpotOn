-- Switch on row-level security for public.reservations.
--
-- The three policies below already exist — they were created in
-- 20260421001633_remote_schema.sql (lines 463-477) and have been inert ever
-- since, because nothing ever ran ENABLE ROW LEVEL SECURITY on the table.
-- Postgres keeps policies attached to a table whether or not row security is
-- on; with it off they are simply never consulted. `\d public.reservations`
-- says so in as many words: "Policies (row security disabled)".
--
-- reservations was the only application table left in that state. listings,
-- profiles, conversations, messages, vehicles, reservation_holds and
-- notification_events all had it enabled already.
--
-- What that meant in practice: the anon role — which is what the publishable
-- key shipped inside the mobile app bundle authenticates as — could read every
-- reservation in the table, including live Stripe payment-intent ids, rewrite
-- any booking's price and status, and DELETE bookings outright, taking their
-- conversation, every message in it and its notification_events rows along via
-- ON DELETE CASCADE. No account was required.
--
-- The intended policies, for reference:
--   reservations_parties_select  SELECT  renter, or owner of the listing
--   reservations_renter_insert   INSERT  renter_id must equal auth.uid()
--   reservations_update_status   UPDATE  renter, or owner of the listing
-- All three are TO authenticated, so anon matches no policy at all and is
-- denied every verb.
--
-- Deliberately NOT adding a DELETE policy: no client should delete a
-- reservation directly, and no frontend code path does. Cancellation flows
-- through the backend, which holds the service-role key and bypasses RLS.

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Fail loudly if this ever silently regresses.
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reservations'::regclass) THEN
    RAISE EXCEPTION 'row-level security is still disabled on public.reservations';
  END IF;
END $$;

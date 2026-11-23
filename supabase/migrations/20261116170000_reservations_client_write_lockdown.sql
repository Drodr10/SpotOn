-- HOTFIX: clients could create "confirmed, paid" bookings without paying.
--
-- APPLY THIS ONE FIRST AND ON ITS OWN — it is independent of every other
-- migration in this branch and safe for every app build currently installed.
--
-- The hole
--   20260906213000 revoked client UPDATE on public.reservations, but INSERT was
--   left granted to anon/authenticated, and reservations_renter_insert only
--   checks renter_id = auth.uid(). So any signed-in user, using the app's
--   public key, could insert a row like
--     { status: 'confirmed', payout_status: 'held', total_price: 0.01,
--       host_payout: 9999, stripe_charge_id: '<anything>' }
--   (verified against a local copy of this schema). That books any spot for
--   free and blocks it for real renters; and the payout sweep later attempts a
--   Stripe transfer of host_payout for 'held' rows — whether Stripe would
--   refuse depends on the charge id supplied, so treat it as a money risk.
--   The same was reachable through finalize_paid_reservation /
--   create_reservation_with_conversation, which are SECURITY INVOKER and were
--   executable by anon/authenticated via the default PUBLIC grant.
--
-- Why this is safe to apply
--   The app never writes reservations itself. Real bookings are inserted by
--   the backend (service_role) from the Stripe webhook / finalize-booking, and
--   cancellations go through the backend too. The only client insert left in
--   the code (utils/api.ts reserveSpot) has no callers and is removed in the
--   same branch. Reads are untouched: reservations_parties_select stays.
--
-- NOT AUTO-DEPLOYED: run in the hosted project's SQL editor (or db push).

BEGIN;

-- ── Table writes: service_role only ────────────────────────────────────────
DROP POLICY IF EXISTS reservations_renter_insert ON public.reservations;
-- reservations_update_status is already inert (UPDATE revoked in
-- 20260906213000); dropped so nobody re-grants UPDATE and revives it.
DROP POLICY IF EXISTS reservations_update_status ON public.reservations;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.reservations FROM anon, authenticated;

-- ── Booking RPCs: backend only ─────────────────────────────────────────────
-- Revoking from PUBLIC also removes service_role's implicit access, so it is
-- granted back explicitly. reservation_validation_error must stay executable by
-- service_role: the validate_reservation_rate trigger calls it while the
-- backend inserts the booking.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'finalize_paid_reservation',
        'create_reservation_with_conversation',
        'acquire_booking_hold',
        'get_available_listings',
        'reservation_validation_error'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

COMMIT;

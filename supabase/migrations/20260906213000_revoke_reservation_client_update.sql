-- Stop a client from directly cancelling a booking (or anything else) via
-- Supabase, bypassing Stripe entirely.
--
-- reservations_update_status grants the renter or the listing owner blanket
-- UPDATE on their own reservation row, with no column restriction -- its own
-- comment said "could be narrowed by column" and never was. That was a
-- theoretical hole while no cancel UI existed anywhere in the app. It stopped
-- being theoretical the moment POST /api/stripe/cancel-reservation shipped
-- (backend/services/payouts.py, cancel_reservation): a client can call
-- supabase.from('reservations').update({status: 'cancelled'}) directly and
-- mark a booking cancelled -- with the row-level policy's blessing -- while
-- the Stripe charge is never refunded and the money stays on the platform
-- balance. Same money-safety class of bug as the charge.refunded webhook gap
-- fixed earlier tonight, just reachable from the client instead of Stripe's
-- dashboard.
--
-- The RLS policy can't express "this row, but only these columns" -- that is
-- a table-level GRANT concern in Postgres, not a USING/WITH CHECK concern. So
-- the fix here is a column-level REVOKE, not a policy rewrite: nothing in the
-- shipped app updates `reservations` through the client role at all today --
-- every real state change (cancel, finalize, the payout sweep) goes through
-- the backend's service_role key, which bypasses RLS entirely. Confirmed by
-- grep: no `.update()` call anywhere in frontend/src targets `reservations`.
--
-- The policy itself is left in place rather than dropped. RLS defaults to
-- deny-all once enabled with no matching policy, so this policy is the safety
-- net for a future feature that needs to hand a specific column back to
-- `authenticated` -- that would require re-adding a column-scoped GRANT AND
-- confirming this policy still says what should be allowed, rather than
-- silently reopening the whole table the moment someone grants UPDATE again.

BEGIN;

REVOKE UPDATE ON TABLE public.reservations FROM authenticated, anon;

COMMENT ON POLICY "reservations_update_status" ON public.reservations IS
  'Row-level half of "who may UPDATE their own reservation" -- currently moot on purpose: UPDATE on this table is revoked from authenticated/anon entirely (see the REVOKE alongside this policy), because nothing in the shipped app updates reservations through the client role. If a future feature needs a client-side reservation update, grant UPDATE on the specific columns it needs -- never status or payout_status, which must only change via a real Stripe refund/transfer, all of which happen through the backend service_role key -- and re-verify this policy''s USING/WITH CHECK still match the intent.';

-- Fail loudly if this ever silently regresses.
DO $$
DECLARE
  can_update boolean;
BEGIN
  SELECT has_table_privilege('authenticated', 'public.reservations', 'UPDATE') INTO can_update;
  IF can_update THEN
    RAISE EXCEPTION 'authenticated still has UPDATE on public.reservations -- the revoke did not take';
  END IF;
END $$;

COMMIT;

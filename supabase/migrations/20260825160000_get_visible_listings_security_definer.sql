-- get_visible_listings must not be filtered by the caller's own RLS.
--
-- The function is the only reservation-reading function the app calls directly
-- (search.tsx and DynamicViewer.tsx); acquire_booking_hold,
-- finalize_paid_reservation, get_available_listings and release_booking_hold are
-- all backend-only and run under the service-role key, which bypasses RLS.
--
-- It was created in 20260712140000 without a SECURITY clause, so it defaults to
-- SECURITY INVOKER: it executes with the privileges of whoever calls it, and it
-- is granted TO anon, authenticated. It reads two RLS-protected tables, and both
-- reads are silently truncated for app callers:
--
--   reservation_holds — RLS was enabled in 20260710120000 and NO policy was ever
--     created for it, so every non-service role matches nothing. The
--     `NOT EXISTS (SELECT 1 FROM reservation_holds ...)` clause is therefore
--     unconditionally true, and a listing sitting under a live checkout hold is
--     never excluded from search. Two renters can both reach the payment sheet;
--     acquire_booking_hold rejects the second one only after they have committed
--     to buy.
--
--   reservations — RLS is enabled on this table (confirmed against the hosted DB
--     on 2026-08-25: pg_class.relrowsecurity is true) and all three of its
--     policies are TO authenticated, matching only the renter or the listing
--     owner. So the active_res CTE sees only the caller's OWN bookings. Two
--     consequences, both wrong: next_available_at comes back NULL for a spot
--     booked by anyone else, so the "schedule after {when}" branch never fires;
--     and `AND (p_include_active_reserved OR ar.ends_at IS NULL)` stops
--     filtering, so the home screen shows occupied spots as free.
--
-- Neither is visible today only because there are currently no active confirmed
-- reservations and no live holds. Both appear on the first real overlapping
-- booking.
--
-- SECURITY DEFINER is the right fix rather than adding read policies: the
-- function is already a curated projection. It returns listing columns plus one
-- derived timestamp and never returns a reservation or hold row, so running it
-- as the owner exposes availability — which is the entire point of the search
-- endpoint — without granting the caller any table-level read on either table.
-- Its own WHERE clause (is_active, available_from/until) remains the visibility
-- gate.
--
-- ALTER rather than CREATE OR REPLACE, deliberately: this changes only the
-- security attributes and leaves the live body exactly as it is, so it cannot
-- overwrite a definition that has drifted from the migration file.

BEGIN;

ALTER FUNCTION public.get_visible_listings(BOOLEAN, BOOLEAN)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- Fail loudly if this ever silently regresses.
--
-- It regresses easily: CREATE OR REPLACE FUNCTION resets every attribute the new
-- statement does not restate, so any future migration that redefines
-- get_visible_listings WITHOUT repeating `SECURITY DEFINER` will quietly drop it
-- back to INVOKER and restore both bugs above, with no error. Any such migration
-- must restate the clause, or re-run this ALTER after it.
--
-- Addressed by regprocedure rather than by matching proname against a rendered
-- argument list: pg_get_function_identity_arguments() includes PARAMETER NAMES
-- ('p_include_upcoming boolean, ...'), so comparing it to 'boolean, boolean'
-- matches nothing, the subquery returns no row, and `IF NOT (SELECT ...)`
-- evaluates NULL — which is not TRUE, so the check passes silently. The cast
-- below raises on its own if the function is missing.
DO $$
DECLARE
  fn         CONSTANT regprocedure := 'public.get_visible_listings(boolean, boolean)'::regprocedure;
  is_definer boolean;
  cfg        text[];
BEGIN
  SELECT p.prosecdef, p.proconfig INTO is_definer, cfg FROM pg_proc p WHERE p.oid = fn;

  IF NOT is_definer THEN
    RAISE EXCEPTION '% is not SECURITY DEFINER', fn;
  END IF;

  IF cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION '% has no pinned search_path (proconfig=%)', fn, cfg;
  END IF;
END $$;

COMMENT ON FUNCTION public.get_visible_listings(BOOLEAN, BOOLEAN) IS
  'Search/Home listing feed. SECURITY DEFINER on purpose: it reads reservations and reservation_holds to compute availability, and under RLS an app caller sees only its own rows there, which makes occupied and held spots look free. Returns listing columns plus next_available_at only — never a reservation or hold row. Any redefinition MUST restate SECURITY DEFINER; CREATE OR REPLACE silently resets it.';

COMMIT;

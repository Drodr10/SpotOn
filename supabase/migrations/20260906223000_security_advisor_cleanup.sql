-- Close three items the Supabase security advisor flagged.
--
-- 1. get_nearby_listings is SECURITY DEFINER, has no search_path pinned, and
--    is directly callable by anon/authenticated -- but nothing calls it.
--    get_visible_listings (20260825160000) superseded it: same purpose
--    (the listing feed's nearby/visible query), correctly scoped to what a
--    caller needs, and is the only such function the app actually uses.
--    Confirmed by grep: no frontend or backend code calls get_nearby_listings.
--    Revoked rather than dropped, in case anything still references it that
--    this search missed -- a revoke is reversible with a single GRANT, a drop
--    is not.
--
-- 2. validate_reservation_rate and validate_reservation_vehicle_owner are
--    trigger functions -- meant to run only as BEFORE INSERT/UPDATE triggers
--    -- but Postgres grants EXECUTE on every new function to PUBLIC by
--    default, so both are directly callable via RPC by anon/authenticated
--    today (e.g. supabase.rpc('validate_reservation_rate')). Calling a
--    trigger function directly errors rather than doing anything useful
--    (both reference NEW/OLD, which only exist inside a real trigger firing)
--    -- so this isn't a live exploit today, but it's public surface area
--    with no reason to exist. Revoking EXECUTE does not affect trigger
--    firing: the trigger mechanism invokes these directly as part of
--    statement execution and does not check the invoking role's EXECUTE
--    privilege on the trigger function, only privileges on the table.
--
-- 3. Pin search_path on all three as defense in depth, matching the
--    convention get_visible_listings already set (20260825160000) -- a
--    SECURITY DEFINER function with an unpinned search_path is the classic
--    search-path-hijacking vector, and revoking public EXECUTE above doesn't
--    help service_role/postgres calling these internally. The two trigger
--    functions are not SECURITY DEFINER, so this is belt-and-suspenders for
--    them rather than closing a real vulnerability.

BEGIN;

-- PUBLIC, not just anon/authenticated: every new Postgres function grants
-- EXECUTE to the implicit PUBLIC pseudo-role by default, and every real role
-- inherits through it. Revoking from anon/authenticated alone is a no-op as
-- long as PUBLIC still has it -- caught by dry-running this migration's own
-- verification block against the live database before trusting it.
REVOKE EXECUTE ON FUNCTION public.get_nearby_listings(double precision, double precision, double precision)
  FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.get_nearby_listings(double precision, double precision, double precision)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.validate_reservation_rate()
  FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.validate_reservation_rate()
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.validate_reservation_vehicle_owner()
  FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.validate_reservation_vehicle_owner()
  SET search_path = public, pg_temp;

-- Fail loudly if any of this ever silently regresses. CREATE OR REPLACE
-- FUNCTION resets attributes the new statement doesn't restate (search_path
-- included), so a future migration redefining one of these without repeating
-- this hardening would quietly undo it with no error.
DO $$
DECLARE
  still_granted boolean;
  unpinned_count int;
BEGIN
  SELECT
    has_function_privilege('anon', 'public.get_nearby_listings(double precision, double precision, double precision)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.get_nearby_listings(double precision, double precision, double precision)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.validate_reservation_rate()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.validate_reservation_rate()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.validate_reservation_vehicle_owner()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.validate_reservation_vehicle_owner()', 'EXECUTE')
  INTO still_granted;
  IF still_granted THEN
    RAISE EXCEPTION 'anon/authenticated can still EXECUTE one of the three revoked functions';
  END IF;

  SELECT count(*) INTO unpinned_count
  FROM pg_proc
  WHERE oid IN (
    'public.get_nearby_listings(double precision, double precision, double precision)'::regprocedure,
    'public.validate_reservation_rate()'::regprocedure,
    'public.validate_reservation_vehicle_owner()'::regprocedure
  ) AND proconfig IS NULL;
  IF unpinned_count > 0 THEN
    RAISE EXCEPTION '% of the three functions still has no search_path pinned', unpinned_count;
  END IF;
END $$;

COMMIT;

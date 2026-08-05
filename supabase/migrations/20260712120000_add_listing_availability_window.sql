-- Migration: Availability-aware listing discovery
--
-- Adds a persistent availability window to listings (available_from /
-- available_until) — previously the Create-Listing DateRangePicker collected
-- these dates but never persisted them.
--
-- Also introduces get_visible_listings(BOOLEAN) as the single source of truth
-- for what shows up on Home and Search. A listing is visible when:
--   1) is_active = TRUE
--   2) available_until is NULL or in the future (not expired)
--   3) available_from is NULL or has already started
--      → Search passes p_include_upcoming=TRUE to also surface not-yet-live
--        listings so the UI can render an "Available on or after {date}" banner.
--      → Home always passes FALSE.
--   4) no confirmed reservation currently overlaps now()
--   5) no unexpired reservation_holds row currently overlaps now()
--
-- payout_status has nothing to do with visibility and is intentionally not
-- referenced here.

BEGIN;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS available_from timestamptz,
  ADD COLUMN IF NOT EXISTS available_until timestamptz;

CREATE OR REPLACE FUNCTION public.get_visible_listings(
    p_include_upcoming BOOLEAN DEFAULT FALSE
)
RETURNS SETOF public.listings
LANGUAGE sql STABLE AS $$
  SELECT l.*
  FROM public.listings l
  WHERE l.is_active = TRUE
    AND (l.available_until IS NULL OR l.available_until > now())
    AND (
      p_include_upcoming
      OR l.available_from IS NULL
      OR l.available_from <= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.listing_id = l.id
        AND r.status = 'confirmed'
        AND r.start_time <= now()
        AND r.end_time   >  now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_holds h
      WHERE h.listing_id = l.id
        AND h.expires_at >  now()
        AND h.start_time <= now()
        AND h.end_time   >  now()
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_visible_listings(BOOLEAN)
  TO anon, authenticated, service_role;

COMMIT;

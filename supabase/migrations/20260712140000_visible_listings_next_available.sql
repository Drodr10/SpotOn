-- Migration: Extend get_visible_listings so Search can surface currently-reserved
-- listings with a "This listing will be available after X" banner.
--
-- Behavior changes:
--   • Home        → hide not-yet-live listings AND currently-reserved listings
--                   (p_include_upcoming=FALSE, p_include_active_reserved=FALSE).
--   • Search      → include both, plus a next_available_at timestamp so the
--                   client can render an appropriate banner + disable the
--                   Current booking tab (p_include_upcoming=TRUE,
--                   p_include_active_reserved=TRUE).
--   • Holds       → still hidden from both surfaces (short-lived; would flicker).
--   • next_available_at = greatest of (available_from, end_time of the
--     confirmed reservation covering now()). NULL when the listing is
--     bookable at now().

BEGIN;

DROP FUNCTION IF EXISTS public.get_visible_listings(BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_visible_listings(
    p_include_upcoming BOOLEAN DEFAULT FALSE,
    p_include_active_reserved BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id uuid,
    owner_id uuid,
    address text,
    latitude double precision,
    longitude double precision,
    price_per_hour numeric,
    is_active boolean,
    photo_url text,
    created_at timestamptz,
    hourly_rate numeric,
    daily_rate numeric,
    weekly_rate numeric,
    monthly_rate numeric,
    available_from timestamptz,
    available_until timestamptz,
    next_available_at timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH active_res AS (
    SELECT r.listing_id, MAX(r.end_time) AS ends_at
      FROM public.reservations r
     WHERE r.status = 'confirmed'
       AND r.start_time <= now()
       AND r.end_time   >  now()
     GROUP BY r.listing_id
  )
  SELECT
    l.id,
    l.owner_id,
    l.address,
    l.latitude,
    l.longitude,
    l.price_per_hour,
    l.is_active,
    l.photo_url,
    l.created_at,
    l.hourly_rate,
    l.daily_rate,
    l.weekly_rate,
    l.monthly_rate,
    l.available_from,
    l.available_until,
    NULLIF(
      GREATEST(
        CASE WHEN l.available_from > now() THEN l.available_from END,
        ar.ends_at
      ),
      NULL
    ) AS next_available_at
  FROM public.listings l
  LEFT JOIN active_res ar ON ar.listing_id = l.id
  WHERE l.is_active = TRUE
    AND (l.available_until IS NULL OR l.available_until > now())
    AND (
      p_include_upcoming
      OR l.available_from IS NULL
      OR l.available_from <= now()
    )
    AND (
      p_include_active_reserved
      OR ar.ends_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reservation_holds h
      WHERE h.listing_id = l.id
        AND h.expires_at >  now()
        AND h.start_time <= now()
        AND h.end_time   >  now()
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_visible_listings(BOOLEAN, BOOLEAN)
  TO anon, authenticated, service_role;

COMMIT;

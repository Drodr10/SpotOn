-- Vehicles: record the plate's issuing state, and freeze a vehicle while it is
-- on a booking that has not finished.
--
-- 1. plate_state
--    Testers pointed out that a plate number alone is ambiguous: "ABC1234" in
--    FL and "ABC1234" in GA are different cars. The column is nullable so the
--    rows that exist today stay valid; the app requires it for new and edited
--    vehicles. Two-letter USPS codes for the 50 states, DC and the inhabited
--    territories.
--
-- 2. Booking lock (trigger)
--    A host identifies the renter's car through
--    get_active_booking_vehicle_for_listing_owner, which JOINs the *live*
--    vehicles row. Now that the app lets renters edit and delete vehicles,
--    changing the plate mid-booking would change what the host sees, and
--    deleting it would make the car disappear from the host's screen. So a
--    vehicle on a confirmed booking that has not ended cannot have its
--    identifying fields changed or be deleted, whoever asks (this also
--    covers the service-role backend).
--
--    It also blocks while the car is on a live checkout hold
--    (reservation_holds, expires_at > now()). Otherwise a renter could press
--    Reserve, delete the car while the payment is in flight, and the webhook's
--    insert would fail validate_reservation_vehicle_owner ("Selected vehicle
--    was not found") — charging them and then auto-refunding. Holds have RLS
--    with no client policies, so the guard is SECURITY DEFINER (pinned
--    search_path, EXECUTE revoked; it only ever looks at OLD.id).
--
--    For reservations, "confirmed AND end_time > now()" is deliberately the exact condition
--    backend/services/account_deletion.py uses to refuse an account deletion,
--    so account deletion — which deletes the user's vehicles — never reaches
--    this trigger in a state where it would fire.
--
-- 3. get_active_booking_vehicle_for_listing_owner now also returns plate_state.
--    The RETURNS TABLE shape changes, so it is dropped and recreated.
--
-- NOT AUTO-DEPLOYED: apply to the hosted project manually, AFTER
-- 20261116120000_vehicle_fk_set_null.sql. The app tolerates plate_state being
-- absent from query results, but writing it fails until this is applied, so
-- apply this before shipping the build that includes the state picker.

BEGIN;

-- ── 1. plate_state ─────────────────────────────────────────────────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS plate_state text;

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_plate_state_check;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_plate_state_check CHECK (
    plate_state IS NULL OR plate_state IN (
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
      'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
      'VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP'
    )
  );

-- ── 2. Booking lock ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_vehicle_in_active_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reservation_holds h
    WHERE h.vehicle_id = OLD.id
      AND h.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'This car is being used for a booking that is checking out right now. Try again in a few minutes.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reservations r
    WHERE r.vehicle_id = OLD.id
      AND r.status = 'confirmed'
      AND r.end_time > now()
  ) THEN
    RAISE EXCEPTION 'This car is on a booking that has not finished yet. You can change or remove it once the booking ends.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_vehicle_in_active_booking() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_vehicle_in_active_booking ON public.vehicles;
-- UPDATE OF limits the check to identifying fields; nothing else on the row
-- (created_at, the generated plate_last4) is ever updated directly.
CREATE TRIGGER trg_guard_vehicle_in_active_booking
BEFORE UPDATE OF make, model, color, license_plate, plate_state OR DELETE
ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.guard_vehicle_in_active_booking();

-- ── 3. Host-facing accessor returns plate_state ────────────────────────────
DROP FUNCTION IF EXISTS public.get_active_booking_vehicle_for_listing_owner(uuid);

CREATE FUNCTION public.get_active_booking_vehicle_for_listing_owner(
  p_reservation_id uuid
)
RETURNS TABLE (
  reservation_id uuid,
  make text,
  model text,
  color text,
  license_plate text,
  plate_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    v.make,
    v.model,
    v.color,
    v.license_plate,
    v.plate_state
  FROM public.reservations r
  JOIN public.listings l
    ON l.id = r.listing_id
  JOIN public.vehicles v
    ON v.id = r.vehicle_id
  WHERE r.id = p_reservation_id
    AND l.owner_id = auth.uid()
    AND r.status <> 'cancelled'
    AND now() >= r.start_time
    AND now() <= r.end_time;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_booking_vehicle_for_listing_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_booking_vehicle_for_listing_owner(uuid) TO authenticated;

COMMIT;

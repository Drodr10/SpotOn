-- Migration: Add vehicle profiles, reservation vehicle requirements, and owner-only active booking vehicle visibility

BEGIN;

-- Vehicle profiles owned by renters.
CREATE TABLE IF NOT EXISTS public.vehicles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    make text NOT NULL,
    model text NOT NULL,
    color text NOT NULL,
    license_plate text NOT NULL,
    plate_last4 text GENERATED ALWAYS AS (right(license_plate, 4)) STORED,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_owner_user_id ON public.vehicles(owner_user_id);

-- Link reservations to a vehicle used for that booking.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id);

CREATE INDEX IF NOT EXISTS idx_reservations_vehicle_id ON public.reservations(vehicle_id);

-- Restrict direct vehicle reads/updates to the owner only.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicles_owner_select ON public.vehicles;
CREATE POLICY vehicles_owner_select
ON public.vehicles
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS vehicles_owner_insert ON public.vehicles;
CREATE POLICY vehicles_owner_insert
ON public.vehicles
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS vehicles_owner_update ON public.vehicles;
CREATE POLICY vehicles_owner_update
ON public.vehicles
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS vehicles_owner_delete ON public.vehicles;
CREATE POLICY vehicles_owner_delete
ON public.vehicles
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

-- Enforce that every new reservation specifies a vehicle owned by the renter.
CREATE OR REPLACE FUNCTION public.validate_reservation_vehicle_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  vehicle_owner uuid;
BEGIN
  IF NEW.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'A vehicle must be selected before reservation checkout';
  END IF;

  SELECT owner_user_id
    INTO vehicle_owner
  FROM public.vehicles
  WHERE id = NEW.vehicle_id;

  IF vehicle_owner IS NULL THEN
    RAISE EXCEPTION 'Selected vehicle was not found';
  END IF;

  IF vehicle_owner <> NEW.renter_id THEN
    RAISE EXCEPTION 'Selected vehicle does not belong to renter';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reservation_vehicle_owner ON public.reservations;
CREATE TRIGGER trg_validate_reservation_vehicle_owner
BEFORE INSERT ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.validate_reservation_vehicle_owner();

-- Owner-only accessor for active reservation vehicle details.
-- This is intentionally SECURITY DEFINER so listing owners can see the renter
-- vehicle during active reservations without direct table-level vehicle access.
CREATE OR REPLACE FUNCTION public.get_active_booking_vehicle_for_listing_owner(
  p_reservation_id uuid
)
RETURNS TABLE (
  reservation_id uuid,
  make text,
  model text,
  color text,
  license_plate text
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
    v.license_plate
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

-- Update reservation creation RPC to require a vehicle.
CREATE OR REPLACE FUNCTION create_reservation_with_conversation(
    p_listing_id UUID,
    p_renter_id UUID,
    p_owner_id UUID,
    p_vehicle_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_total_price NUMERIC,
    p_platform_fee NUMERIC,
    p_host_payout NUMERIC
)
RETURNS TABLE(
    reservation_id UUID,
    conversation_id UUID,
    error_message TEXT
) AS $$
DECLARE
    v_reservation_id UUID;
    v_conversation_id UUID;
BEGIN
    INSERT INTO reservations (
      listing_id,
      renter_id,
      vehicle_id,
      start_time,
      end_time,
      total_price,
      platform_fee,
      host_payout,
      status
    )
    VALUES (
      p_listing_id,
      p_renter_id,
      p_vehicle_id,
      p_start_time,
      p_end_time,
      p_total_price,
      p_platform_fee,
      p_host_payout,
      'pending'
    )
    RETURNING id INTO v_reservation_id;

    INSERT INTO conversations (reservation_id, renter_id, owner_id, status)
    VALUES (v_reservation_id, p_renter_id, p_owner_id, 'active')
    RETURNING id INTO v_conversation_id;

    RETURN QUERY SELECT v_reservation_id, v_conversation_id, NULL::TEXT;

    EXCEPTION
        WHEN exclusion_violation THEN
            RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Reservation overlaps with existing booking'::TEXT;
        WHEN OTHERS THEN
            RETURN QUERY SELECT NULL::UUID, NULL::UUID, ('Database error: ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMIT;

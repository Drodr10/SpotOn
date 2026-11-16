-- Let a vehicle be deleted after it has been used for a booking.
--
-- reservations.vehicle_id was added in 20260522143000 as a bare
-- `REFERENCES public.vehicles(id)`, i.e. ON DELETE NO ACTION. Any vehicle that
-- appears on even one reservation therefore cannot be deleted, which breaks:
--
--   * account deletion — backend/services/account_deletion.py deletes the
--     user's vehicles first (plates are the most sensitive thing we hold), so
--     every renter with booking history hit an FK violation and could not delete
--     their account (App Store guideline 5.1.1(v) requires this to work);
--   * any future "remove this car" UI.
--
-- ON DELETE SET NULL keeps the reservation (money/payout history must survive)
-- and drops only the link to the plate. That is the desired privacy outcome for
-- account deletion. It is safe against the existing triggers:
--
--   * trg_validate_reservation_vehicle_owner is BEFORE INSERT only, so the
--     NOT NULL vehicle rule still applies to new bookings but not to this update;
--   * trg_validate_reservation_rate fires only on UPDATE OF listing_id,
--     start_time, end_time (20260808140000), none of which change here.
--
-- Hosts who view an old booking whose vehicle was removed get no vehicle row
-- back from get_active_booking_vehicle_for_listing_owner; the app already
-- treats "no vehicle" as a normal state.
--
-- NOT AUTO-DEPLOYED: apply to the hosted project manually (SQL editor or
-- `supabase db push`).

BEGIN;

DO $$
DECLARE
  fk_name text;
BEGIN
  -- Look the constraint(s) up rather than assume the default name, and drop
  -- every match: if the hosted database drifted and holds two FKs on this
  -- column, leaving one NO ACTION FK behind would keep deletes failing.
  FOR fk_name IN
    SELECT DISTINCT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.reservations'::regclass
      AND con.confrelid = 'public.vehicles'::regclass
      AND con.contype = 'f'
      AND att.attname = 'vehicle_id'
  LOOP
    EXECUTE format('ALTER TABLE public.reservations DROP CONSTRAINT %I', fk_name);
  END LOOP;
END;
$$;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;

COMMIT;

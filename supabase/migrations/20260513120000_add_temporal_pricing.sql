-- Migration: Add temporal pricing columns and reservation financial fields
-- Adds hourly/daily/weekly/monthly rates to listings and platform_fee/host_payout to reservations
-- Also creates a DB trigger to validate that the listing supports the required tier for a reservation duration

BEGIN;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS daily_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS weekly_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS monthly_rate numeric(10,2);

-- Backfill hourly_rate from legacy price_per_hour where present
UPDATE public.listings
SET hourly_rate = price_per_hour
WHERE price_per_hour IS NOT NULL AND hourly_rate IS NULL;

-- Add financial reporting columns to reservations
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS platform_fee numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS host_payout numeric(10,2) DEFAULT 0;

-- Validation function: ensure listing has appropriate rate for requested duration
CREATE OR REPLACE FUNCTION public.validate_reservation_rate() RETURNS trigger AS $$
DECLARE
  listing_row RECORD;
  duration_hours numeric;
  duration_days numeric;
  duration_weeks numeric;
  epsilon numeric := 0.000001;
BEGIN
  SELECT * INTO listing_row FROM public.listings WHERE id = NEW.listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  duration_hours := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600.0;
  duration_days := duration_hours / 24.0;
  duration_weeks := duration_days / 7.0;

  IF duration_weeks + epsilon >= 4.0 THEN
    IF listing_row.monthly_rate IS NULL THEN
      RAISE EXCEPTION 'Monthly bookings not supported for this listing';
    END IF;
  ELSIF duration_days + epsilon >= 7.0 THEN
    IF listing_row.weekly_rate IS NULL THEN
      RAISE EXCEPTION 'Weekly bookings not supported for this listing';
    END IF;
  ELSIF duration_hours + epsilon >= 9.0 THEN
    IF listing_row.daily_rate IS NULL THEN
      RAISE EXCEPTION 'Daily bookings not supported for this listing';
    END IF;
  ELSE
    IF listing_row.hourly_rate IS NULL THEN
      RAISE EXCEPTION 'Hourly bookings not supported for this listing';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger BEFORE INSERT OR UPDATE on reservations
DROP TRIGGER IF EXISTS trg_validate_reservation_rate ON public.reservations;
CREATE TRIGGER trg_validate_reservation_rate
BEFORE INSERT OR UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.validate_reservation_rate();

COMMIT;

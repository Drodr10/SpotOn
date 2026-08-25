-- Fix the "payment succeeded, booking not confirmed" class of bug by giving the
-- reservation rules ONE implementation that both the database and the backend
-- call, and by aligning that rule with the pricing engine.
--
-- THE BUG. Two implementations of "which durations may be booked" disagreed:
--
--   * backend/utils/pricing.py (calculate_final_price) picks the best tier
--     available and FALLS BACK — no daily_rate? charge hourly. It only refuses
--     when the listing has no usable rate at all.
--   * validate_reservation_rate() required the tier matching the duration to
--     exist: >= 9h demanded daily_rate, >= 7d demanded weekly_rate, >= 4w
--     demanded monthly_rate, else demanded hourly_rate.
--
-- Money moves in create_booking_payment (which prices with Python), while the
-- trigger only fires later, at finalize_paid_reservation's INSERT. So a booking
-- Python priced happily was rejected AFTER Stripe captured: the renter is
-- charged, no reservation row exists, and finalize's `WHEN OTHERS` handler
-- surfaces 'db_P0001: <the trigger's message>' to the app.
--
-- Two live instances, both reproduced against this schema:
--   A. 96h booking on a $3/hr listing with daily_rate NULL. Python: 96 * 3 =
--      $288 + 15% = $331.20 captured. Trigger: 'Daily bookings not supported'.
--   B. a plain 2h booking on a legacy listing where only price_per_hour is set
--      and hourly_rate is NULL. Python falls back to price_per_hour and prices
--      it; the trigger read hourly_rate only and raised 'Hourly bookings not
--      supported'. price_per_hour is NOT NULL on listings while hourly_rate is
--      nullable, so this shape is not hypothetical.
--
-- THE RULING (Ehan, 2026-07-26): "users should be able to still reserve for
-- more than a day, they would just be charged with the hourly rate", and no cap
-- on how long an hourly booking may run — "if a daily rate is available then
-- the app automatically switches to that anyways" (which
-- _compute_hourly_with_day_cap already does). So the tier-must-exist rule was
-- the wrong side, not the pricing engine.
--
-- WHY NOT JUST DROP THE TRIGGER. Its last arm is a real guard: a reservation
-- against a listing with no usable rate would store a price derived from
-- nothing. That case is kept. What changes is that it now rejects exactly when
-- the pricing engine would refuse to price.
--
-- WHY A SHARED FUNCTION. The root cause was two copies of one rule drifting
-- apart with nothing forcing them to move together. reservation_validation_error
-- is now the single definition: the trigger raises whatever it returns, and the
-- backend calls the SAME function over RPC before it creates a PaymentIntent
-- (see create_booking_payment). Any rule added here is therefore enforced
-- before the card is charged, not after — which is the only ordering that
-- cannot strand a paid renter.

BEGIN;

-- Returns NULL when the reservation is allowed, or a human-readable reason why
-- it is not. STABLE and side-effect free so it is safe to call speculatively
-- from the pre-charge path.
--
-- p_start_time / p_end_time are accepted even though today's rules only depend
-- on the listing's rate columns: duration-dependent rules (availability
-- windows, max-duration caps) belong here next, and taking the parameters now
-- means both callers pick those rules up without another signature change.
CREATE OR REPLACE FUNCTION public.reservation_validation_error(
  p_listing_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz
) RETURNS text AS $$
DECLARE
  listing_row RECORD;
  effective_hourly numeric;
BEGIN
  IF p_end_time <= p_start_time THEN
    RETURN 'end_time must be after start_time';
  END IF;

  SELECT * INTO listing_row FROM public.listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RETURN 'Listing not found';
  END IF;

  -- Same precedence as pricing.calculate_final_price: hourly_rate wins, then
  -- the legacy price_per_hour column.
  effective_hourly := COALESCE(listing_row.hourly_rate, listing_row.price_per_hour);

  -- Reject only what the pricing engine itself would refuse to price. Any
  -- duration is bookable as long as SOME rate exists: the engine selects the
  -- cheapest applicable tier and caps hourly runs at the daily rate when set.
  IF effective_hourly IS NULL
     AND listing_row.daily_rate IS NULL
     AND listing_row.weekly_rate IS NULL
     AND listing_row.monthly_rate IS NULL
  THEN
    RETURN 'No rates available for this listing';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.reservation_validation_error(uuid, timestamptz, timestamptz) IS
  'Single source of truth for "may this reservation exist". Returns NULL if allowed, else the reason. Called by the validate_reservation_rate trigger (which raises it) AND by the backend before creating a PaymentIntent, so no rule can reject a booking only after the renter has been charged. Mirrors pricing.calculate_final_price, which falls back across tiers rather than requiring the tier matching the duration.';

GRANT EXECUTE ON FUNCTION public.reservation_validation_error(uuid, timestamptz, timestamptz)
  TO authenticated, service_role, anon;

-- The trigger becomes a thin raiser over the shared rule.
CREATE OR REPLACE FUNCTION public.validate_reservation_rate()
RETURNS TRIGGER AS $$
DECLARE
  validation_error text;
BEGIN
  validation_error := public.reservation_validation_error(
    NEW.listing_id, NEW.start_time, NEW.end_time
  );
  IF validation_error IS NOT NULL THEN
    RAISE EXCEPTION '%', validation_error;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.validate_reservation_rate() IS
  'Last-line enforcement of reservation_validation_error(). Deliberately holds no rules of its own: money is captured before this fires, so anything enforced ONLY here strands a paid renter with no reservation.';

COMMIT;

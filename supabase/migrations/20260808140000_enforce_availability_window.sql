-- Enforce a listing's availability window, and stop bookings starting in the past.
--
-- available_from / available_until were read in exactly one place —
-- get_visible_listings, which decides what appears on Home and Search. That is
-- discovery, not enforcement: the date picker clamps to the window, but a direct
-- API call ignores it entirely. A listing whose window closed on 31 July
-- accepted, held and finalised a paid, confirmed booking for 10 August, with no
-- error anywhere in the chain. Because nothing raised, the auto-refund path
-- never fired either: the owner's stated terms were violated silently, with real
-- money captured.
--
-- Not hypothetical here. 11 of 18 listings carry a window and 9 of those expired
-- on 31 July, so most of the live data is bookable-but-shouldn't-be today.
--
-- ── WHERE EACH RULE GOES, AND WHY IT MATTERS ───────────────────────────────
--
-- reservation_validation_error is called TWICE for one booking: once by
-- create_booking_payment BEFORE the card is charged, and again by the
-- trg_validate_reservation_rate trigger when the row is inserted, which happens
-- AFTER payment succeeds. A rule enforced in that function must therefore give
-- the SAME answer at both moments. If it can flip in between, the booking is
-- charged and then refused — the exact failure #63 was written to eliminate.
--
-- That sorts the two rules in this migration:
--
--   Availability window — compares the booking's own start/end against the
--     listing's window. Nothing about it depends on when it is evaluated, so it
--     is safe in the shared function and is enforced on both paths.
--
--   Start time not in the past — depends on now(), so its answer changes
--     continuously. Enforced at insert it would reject a Stripe webhook RETRY
--     arriving minutes or hours later, stranding a renter who paid. It is
--     therefore enforced ONLY in acquire_booking_hold, which runs before any
--     PaymentIntent exists, where a rejection costs nothing.
--
-- NULL means "no constraint", matching get_visible_listings. Bounds are
-- inclusive: a booking may start exactly at available_from and end exactly at
-- available_until.

BEGIN;

-- ── M5: stop bookkeeping updates re-running validation ─────────────────────
-- The trigger fired on INSERT OR UPDATE, so it re-validated on every write to
-- a reservation — including the payout sweep's payout_status updates. That was
-- harmless only while every rule depended solely on the listing's rate columns.
-- Adding an availability rule re-arms it: a booking made inside a window, then
-- updated by the sweep after that window closes, would start failing, blocking
-- payouts and opening a second route into the pay-then-refund loss.
--
-- Narrowed to the columns the rules actually read. UPDATE OF fires only when a
-- statement mentions one of these, so payout_status bookkeeping no longer
-- triggers validation, while a genuine reschedule still does.
DROP TRIGGER IF EXISTS trg_validate_reservation_rate ON public.reservations;
CREATE TRIGGER trg_validate_reservation_rate
BEFORE INSERT OR UPDATE OF listing_id, start_time, end_time ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.validate_reservation_rate();

-- ── B3: the window becomes a rule, not a display hint ──────────────────────
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

  -- The owner's stated availability. NULL on either side means unbounded.
  -- Time-invariant: this compares the booking to the listing, never to now(),
  -- so it cannot flip between the pre-charge call and the insert-time one.
  IF listing_row.available_from IS NOT NULL
     AND p_start_time < listing_row.available_from THEN
    RETURN 'This spot is not available until '
           || to_char(listing_row.available_from, 'Mon DD, YYYY');
  END IF;

  IF listing_row.available_until IS NOT NULL
     AND p_end_time > listing_row.available_until THEN
    RETURN 'This spot is only available until '
           || to_char(listing_row.available_until, 'Mon DD, YYYY');
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.reservation_validation_error(uuid, timestamptz, timestamptz) IS
  'Single source of truth for "may this reservation exist". Returns NULL if allowed, else the reason. Called by the validate_reservation_rate trigger (which raises it) AND by the backend before creating a PaymentIntent, so no rule can reject a booking only after the renter has been charged. Every rule here MUST be time-invariant: it is evaluated once before payment and again at insert, and a rule whose answer changes in between strands a paid renter. Rules that depend on now() belong in acquire_booking_hold instead.';

GRANT EXECUTE ON FUNCTION public.reservation_validation_error(uuid, timestamptz, timestamptz)
  TO authenticated, service_role, anon;

-- ── The hold refuses the same bookings, earlier and more cheaply ───────────
-- acquire_booking_hold runs on Reserve-press, before any Stripe object exists,
-- so a rejection here costs nothing at all. It carries both the shared rules
-- and the now()-dependent one that must never reach the trigger.
CREATE OR REPLACE FUNCTION public.acquire_booking_hold(
    p_listing_id UUID,
    p_renter_id UUID,
    p_vehicle_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_ttl_minutes INT DEFAULT 5
)
RETURNS TABLE(hold_id UUID, expires_at TIMESTAMPTZ, error_message TEXT) AS $$
DECLARE
    v_hold_id UUID;
    v_expires TIMESTAMPTZ;
    v_validation_error TEXT;
BEGIN
    -- Shared rules first: rates, ordering, and the availability window.
    v_validation_error := public.reservation_validation_error(
        p_listing_id, p_start_time, p_end_time
    );
    IF v_validation_error IS NOT NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ, v_validation_error;
        RETURN;
    END IF;

    -- Then the rule that may not live in the shared function. The client freezes
    -- start_time when the booking screen mounts and never refreshes it, so a
    -- renter who sits on that screen books further and further into the past and
    -- pays for time they cannot use. The tolerance is deliberate rather than
    -- zero: start_time is captured before checkout, so a few minutes of drift is
    -- ordinary. This is a backstop against booking retroactively, not a
    -- precision clock — the display accuracy is fixed client-side.
    IF p_start_time < now() - INTERVAL '15 minutes' THEN
        RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ,
            'This booking would start in the past. Please pick a new time.'::TEXT;
        RETURN;
    END IF;

    -- Serialize all hold activity for this listing.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_listing_id::text, 0));

    -- Clear expired holds for this listing so they don't block new ones.
    -- Qualify expires_at: the OUT column of the same name would be ambiguous.
    DELETE FROM public.reservation_holds
     WHERE listing_id = p_listing_id AND reservation_holds.expires_at <= now();

    -- Re-pressing Reserve replaces this renter's own prior hold on this listing.
    DELETE FROM public.reservation_holds
     WHERE listing_id = p_listing_id AND renter_id = p_renter_id;

    -- Conflict with another renter's live hold?
    IF EXISTS (
        SELECT 1 FROM public.reservation_holds h
         WHERE h.listing_id = p_listing_id
           AND tstzrange(h.start_time, h.end_time) && tstzrange(p_start_time, p_end_time)
    ) THEN
        RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ, 'slot_unavailable'::TEXT;
        RETURN;
    END IF;

    -- Conflict with an existing (non-cancelled) reservation?
    IF EXISTS (
        SELECT 1 FROM public.reservations r
         WHERE r.listing_id = p_listing_id
           AND r.status <> 'cancelled'
           AND tstzrange(r.start_time, r.end_time) && tstzrange(p_start_time, p_end_time)
    ) THEN
        RETURN QUERY SELECT NULL::UUID, NULL::TIMESTAMPTZ, 'slot_unavailable'::TEXT;
        RETURN;
    END IF;

    v_expires := now() + make_interval(mins => p_ttl_minutes);
    INSERT INTO public.reservation_holds (listing_id, renter_id, vehicle_id, start_time, end_time, expires_at)
    VALUES (p_listing_id, p_renter_id, p_vehicle_id, p_start_time, p_end_time, v_expires)
    RETURNING id INTO v_hold_id;

    RETURN QUERY SELECT v_hold_id, v_expires, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMIT;

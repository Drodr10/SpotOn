-- Migration: Booking holds (hold-and-confirm checkout)
--
-- Introduces a short-lived "hold" a renter acquires the moment they press
-- Reserve. While a live (non-expired) hold exists for an overlapping slot, no
-- other renter can press Reserve. The real reservation row is NOT created until
-- payment succeeds (see stripe webhook); the hold merely locks the slot during
-- checkout and self-expires after a TTL so an abandoned checkout frees the slot.
--
--   press Reserve  -> acquire_booking_hold  (row in reservation_holds)
--   payment ok     -> finalize_paid_reservation (real reservations row) + hold deleted
--   TTL elapsed    -> sweep deletes the hold (slot bookable again)

BEGIN;

CREATE TABLE IF NOT EXISTS public.reservation_holds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
    renter_id uuid NOT NULL,
    vehicle_id uuid,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservation_holds_listing ON public.reservation_holds(listing_id);
CREATE INDEX IF NOT EXISTS idx_reservation_holds_expires ON public.reservation_holds(expires_at);

-- Holds are backend-only (service_role). Enable RLS with no policies so the
-- anon/authenticated API can't read or write them.
ALTER TABLE public.reservation_holds ENABLE ROW LEVEL SECURITY;

-- Idempotency guard: one reservation per PaymentIntent (webhook retries safe).
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_payment_intent
  ON public.reservations(stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

-- ── acquire_booking_hold ────────────────────────────────────────────────────
-- Atomically claim a hold for (listing, slot). Serialized per-listing via an
-- advisory lock so two simultaneous Reserve taps can't both win. Overlap is
-- checked against BOTH other live holds AND non-cancelled reservations.
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
BEGIN
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

-- ── finalize_paid_reservation ───────────────────────────────────────────────
-- Called by the stripe webhook once payment succeeds. Creates the real
-- reservation row (no conversation — chat is created client-side). Idempotent
-- on payment_intent. Frees the renter's hold for this listing.
CREATE OR REPLACE FUNCTION public.finalize_paid_reservation(
    p_listing_id UUID,
    p_renter_id UUID,
    p_vehicle_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_total_price NUMERIC,
    p_platform_fee NUMERIC,
    p_host_payout NUMERIC,
    p_payment_intent TEXT,
    p_charge_id TEXT
)
RETURNS TABLE(reservation_id UUID, error_message TEXT) AS $$
DECLARE
    v_reservation_id UUID;
BEGIN
    -- Idempotency: webhook may fire more than once for the same PI.
    SELECT id INTO v_reservation_id
      FROM public.reservations
     WHERE stripe_payment_intent = p_payment_intent
     LIMIT 1;
    IF v_reservation_id IS NOT NULL THEN
        DELETE FROM public.reservation_holds
         WHERE listing_id = p_listing_id AND renter_id = p_renter_id;
        RETURN QUERY SELECT v_reservation_id, NULL::TEXT;
        RETURN;
    END IF;

    INSERT INTO public.reservations (
        listing_id, renter_id, vehicle_id, start_time, end_time,
        total_price, platform_fee, host_payout,
        status, payout_status, stripe_payment_intent, stripe_charge_id
    )
    VALUES (
        p_listing_id, p_renter_id, p_vehicle_id, p_start_time, p_end_time,
        p_total_price, p_platform_fee, p_host_payout,
        'confirmed', 'held', p_payment_intent, p_charge_id
    )
    RETURNING id INTO v_reservation_id;

    DELETE FROM public.reservation_holds
     WHERE listing_id = p_listing_id AND renter_id = p_renter_id;

    RETURN QUERY SELECT v_reservation_id, NULL::TEXT;

    EXCEPTION
        WHEN exclusion_violation THEN
            RETURN QUERY SELECT NULL::UUID, 'slot_unavailable'::TEXT;
        WHEN OTHERS THEN
            RETURN QUERY SELECT NULL::UUID, ('Database error: ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMIT;

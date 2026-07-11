-- Surface the real Postgres error class from finalize_paid_reservation.
-- Previously the WHEN OTHERS handler swallowed everything into a generic
-- "Database error: <msg>" string, which made 500s (trigger failures, cast
-- errors, etc.) opaque. Include SQLSTATE + SQLERRM so the frontend alert
-- has enough to diagnose without server logs.

BEGIN;

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
            RETURN QUERY SELECT
                NULL::UUID,
                ('db_' || SQLSTATE || ': ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMIT;

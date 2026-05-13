-- Migration: Update create_reservation_with_conversation RPC to accept platform fee and host payout

CREATE OR REPLACE FUNCTION create_reservation_with_conversation(
    p_listing_id UUID,
    p_renter_id UUID,
    p_owner_id UUID,
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
    -- Insert reservation (exclusion constraint will reject overlaps)
    INSERT INTO reservations (listing_id, renter_id, start_time, end_time, total_price, platform_fee, host_payout, status)
    VALUES (p_listing_id, p_renter_id, p_start_time, p_end_time, p_total_price, p_platform_fee, p_host_payout, 'pending')
    RETURNING id INTO v_reservation_id;
    
    -- Auto-create conversation
    INSERT INTO conversations (reservation_id, renter_id, owner_id, status)
    VALUES (v_reservation_id, p_renter_id, p_owner_id, 'active')
    RETURNING id INTO v_conversation_id;
    
    -- Return success
    RETURN QUERY SELECT v_reservation_id, v_conversation_id, NULL::TEXT;
    
    EXCEPTION 
        WHEN exclusion_violation THEN
            RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'Reservation overlaps with existing booking'::TEXT;
        WHEN OTHERS THEN
            RETURN QUERY SELECT NULL::UUID, NULL::UUID, ('Database error: ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Migration: Add exclusion constraint, availability RPC, and reservation sync functions for Ticket #6

-- Enable GIST extension for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Add exclusion constraint: prevent overlapping reservations for the same listing
ALTER TABLE reservations
ADD CONSTRAINT reservations_no_overlap 
EXCLUDE USING gist (
    listing_id WITH =,
    tstzrange(start_time, end_time) WITH &&
) WHERE (status != 'cancelled');

-- RPC function: Get available listings for a given time range
CREATE OR REPLACE FUNCTION get_available_listings(
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ
)
RETURNS TABLE(
    id UUID,
    owner_id UUID,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    price_per_hour NUMERIC,
    is_active BOOLEAN,
    photo_url TEXT,
    created_at TIMESTAMPTZ
) AS $$
SELECT 
    l.id,
    l.owner_id,
    l.address,
    l.latitude,
    l.longitude,
    l.price_per_hour,
    l.is_active,
    l.photo_url,
    l.created_at
FROM listings l
WHERE l.is_active = TRUE
AND l.id NOT IN (
    SELECT DISTINCT listing_id FROM reservations
    WHERE status != 'cancelled'
    AND start_time < p_end_time
    AND end_time > p_start_time
)
$$ LANGUAGE SQL STABLE;

-- RPC function: Create reservation with conversation and handle sync atomically
CREATE OR REPLACE FUNCTION create_reservation_with_conversation(
    p_listing_id UUID,
    p_renter_id UUID,
    p_owner_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_total_price NUMERIC
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
    INSERT INTO reservations (listing_id, renter_id, start_time, end_time, total_price, status)
    VALUES (p_listing_id, p_renter_id, p_start_time, p_end_time, p_total_price, 'pending')
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

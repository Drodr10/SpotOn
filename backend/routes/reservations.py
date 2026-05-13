from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

reservations_bp = Blueprint('reservations', __name__)

@reservations_bp.route('/reservations/<user_id>', methods=['GET'])
def get_reservations(user_id):
    # in sql this would be: SELECT * FROM reservations WHERE user_id = {user_id}
    response = supabase.table("reservations").select("*").eq("renter_id", user_id).execute()
    return jsonify(response.data), 200

@reservations_bp.route('/reservations', methods=['POST'])
def book_spot():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    # Extract required fields
    listing_id = data.get("listing_id")
    renter_id = data.get("renter_id")
    start_time = data.get("start_time")
    end_time = data.get("end_time")
    total_price = data.get("total_price")
    
    # Validate required fields
    if not all([listing_id, renter_id, start_time, end_time, total_price]):
        return jsonify({"error": "Missing required fields"}), 400
    
    # Fetch listing owner
    try:
        listing = supabase.table("listings").select("owner_id").eq("id", listing_id).single().execute()
        owner_id = listing.data["owner_id"]
    except Exception as e:
        return jsonify({"error": "Listing not found"}), 404
    
    # Call RPC function (atomic transaction; exclusion constraint handles overlap)
    try:
        result = supabase.rpc("create_reservation_with_conversation", {
            "p_listing_id": listing_id,
            "p_renter_id": renter_id,
            "p_owner_id": owner_id,
            "p_start_time": start_time,
            "p_end_time": end_time,
            "p_total_price": total_price
        }).execute()
        
        response_data = result.data[0] if result.data else {}
        error_msg = response_data.get("error_message")
        
        if error_msg:
            return jsonify({"error": error_msg}), 409
        
        reservation_id = response_data.get("reservation_id")
        conversation_id = response_data.get("conversation_id")
        
        if not reservation_id:
            return jsonify({"error": "Failed to create reservation"}), 500
        
        return jsonify({
            "reservation_id": reservation_id,
            "conversation_id": conversation_id,
            "message": "Reservation created successfully and conversation initiated"
        }), 201
        
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500
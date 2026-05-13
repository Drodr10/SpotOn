from flask import Blueprint, jsonify, request
from services.supabase_client import supabase
from utils.pricing import calculate_final_price, PricingError

reservations_bp = Blueprint('reservations', __name__)


@reservations_bp.route('/reservations/<user_id>', methods=['GET'])
def get_reservations(user_id):
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

    # Validate required fields (total_price must be computed server-side)
    if not all([listing_id, renter_id, start_time, end_time]):
        return jsonify({"error": "Missing required fields"}), 400

    # Fetch listing owner and rates
    try:
        listing_resp = supabase.table("listings").select(
            "owner_id, hourly_rate, daily_rate, weekly_rate, monthly_rate"
        ).eq("id", listing_id).single().execute()
        listing_row = listing_resp.data
        if not listing_row:
            return jsonify({"error": "Listing not found"}), 404
        owner_id = listing_row.get("owner_id")
    except Exception:
        return jsonify({"error": "Listing not found"}), 404

    # Server-side price calculation
    try:
        price_breakdown = calculate_final_price(listing_row, start_time, end_time)
    except PricingError as pe:
        return jsonify({"error": str(pe)}), 400
    except Exception as e:
        return jsonify({"error": f"Pricing error: {str(e)}"}), 500

    total_price = price_breakdown["total"]
    platform_fee = price_breakdown["platform_fee"]
    host_payout = price_breakdown["host_payout"]

    # Call RPC function (atomic transaction; exclusion constraint handles overlap)
    try:
        result = supabase.rpc("create_reservation_with_conversation", {
            "p_listing_id": listing_id,
            "p_renter_id": renter_id,
            "p_owner_id": owner_id,
            "p_start_time": start_time,
            "p_end_time": end_time,
            "p_total_price": str(total_price)
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
            "total_price": str(total_price),
            "platform_fee": str(platform_fee),
            "host_payout": str(host_payout),
            "message": "Reservation created successfully and conversation initiated"
        }), 201

    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500
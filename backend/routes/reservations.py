from flask import Blueprint, jsonify, request
from services.supabase_client import supabase
from utils.pricing import calculate_final_price, PricingError
from services.auth import token_required

reservations_bp = Blueprint('reservations', __name__)


@reservations_bp.route('/reservations/preview', methods=['GET'])
def preview_price():
    """
    Preview the final price for a listing without creating a reservation.
    Query parameters: listing_id, start_time (ISO 8601), end_time (ISO 8601)
    Returns: { subtotal, platform_fee, host_payout, total, tier, units, rate }
    """
    listing_id = request.args.get('listing_id')
    start_time = request.args.get('start_time')
    end_time = request.args.get('end_time')

    if not all([listing_id, start_time, end_time]):
        return jsonify({"error": "Missing query parameters: listing_id, start_time, end_time"}), 400

    # Fetch listing rates. Include legacy price_per_hour so the pricing engine's
    # fallback works for older listings created before hourly_rate existed.
    try:
        listing_resp = supabase.table("listings").select(
            "hourly_rate, daily_rate, weekly_rate, monthly_rate, price_per_hour"
        ).eq("id", listing_id).single().execute()
        listing_row = listing_resp.data
        if not listing_row:
            return jsonify({"error": "Listing not found"}), 404
    except Exception:
        return jsonify({"error": "Listing not found"}), 404

    # Compute pricing
    try:
        price_breakdown = calculate_final_price(listing_row, start_time, end_time)
        response_body = {
            "subtotal": str(price_breakdown["subtotal"]),
            "platform_fee": str(price_breakdown["platform_fee"]),
            "host_payout": str(price_breakdown["host_payout"]),
            "total": str(price_breakdown["total"]),
            "tier": price_breakdown["tier"],
            "units": str(price_breakdown["units"]),
            "rate": str(price_breakdown["rate"]),
        }
        if "line_items" in price_breakdown:
            response_body["line_items"] = [
                {
                    "tier": li["tier"],
                    "rate": str(li["rate"]),
                    "units": str(li["units"]),
                    "subtotal": str(li["subtotal"]),
                }
                for li in price_breakdown["line_items"]
            ]
        return jsonify(response_body), 200
    except PricingError as pe:
        return jsonify({"error": str(pe)}), 400
    except Exception as e:
        return jsonify({"error": f"Pricing error: {str(e)}"}), 500


@reservations_bp.route('/reservations/<user_id>', methods=['GET'])
@token_required
def get_reservations(current_user_id, user_id):
    if current_user_id != user_id:
        return jsonify({"error": "Forbidden: You can only access your own reservations."}), 403
    response = supabase.table("reservations").select("*").eq("renter_id", user_id).execute()
    return jsonify(response.data), 200


# Retired. This used to insert a 'pending' reservation through
# create_reservation_with_conversation with no PaymentIntent behind it. The
# payout sweep only expires rows that have a PaymentIntent, so those rows never
# went away: any signed-in user could block any listing's calendar for free.
# The app never called it; real bookings go through
# /api/stripe/create-booking-payment and are inserted only once paid
# (finalize_paid_reservation, from the webhook or /api/stripe/finalize-booking).
# 410 rather than 404 so an old client or script gets a clear answer. Left
# unauthenticated on purpose: it does nothing for anyone.
@reservations_bp.route('/reservations', methods=['POST'])
def book_spot():
    return jsonify({
        "error": "This endpoint has been removed. Bookings are created through "
                 "checkout: POST /api/stripe/create-booking-payment.",
    }), 410

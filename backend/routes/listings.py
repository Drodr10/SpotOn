from flask import Blueprint, jsonify, request
from services.supabase_client import supabase
from datetime import datetime

listings_bp = Blueprint('listings', __name__)

def parse_dt(dt_str):
    if not dt_str:
        return None
    if dt_str.endswith('Z'):
        dt_str = dt_str[:-1] + '+00:00'
    return datetime.fromisoformat(dt_str)

@listings_bp.route('/listings', methods=['GET'])
def get_all_listings():
    # Query parameters for availability check (optional)
    start_time_str = request.args.get('start_time')  # ISO 8601
    end_time_str = request.args.get('end_time')      # ISO 8601
    
    if start_time_str and end_time_str:
        try:
            req_start = parse_dt(start_time_str)
            req_end = parse_dt(end_time_str)

            # Part A: Availability Check (Pull active listings)
            listings_resp = supabase.table("listings").select("*").eq("is_active", True).execute()
            all_listings = listings_resp.data if listings_resp.data else []

            # Part B: Exclusion Check (Fetch active reservations)
            reservations_resp = supabase.table("reservations")\
                .select("listing_id, start_time, end_time, status")\
                .execute()
            all_reservations = reservations_resp.data if reservations_resp.data else []

            # Filter to active blocking reservations only
            blocking_statuses = ['pending', 'confirmed', 'paid']
            active_reservations = [res for res in all_reservations if res.get('status') in blocking_statuses]

            # Filter out listings that have overlapping reservations
            available_listings = []
            for listing in all_listings:
                is_booked = False
                for res in active_reservations:
                    if res["listing_id"] == listing["id"]:
                        res_start = parse_dt(res["start_time"])
                        res_end = parse_dt(res["end_time"])
                        # Exclusion condition: (requested_start < booking_end) AND (requested_end > booking_start)
                        if req_start < res_end and req_end > res_start:
                            is_booked = True
                            break

                if not is_booked:
                    available_listings.append(listing)

            return jsonify(available_listings), 200
        except Exception as e:
            return jsonify({"error": f"Search failed: {str(e)}"}), 500
    else:
        # Backward compatible: return all active listings (no time filtering)
        response = supabase.table("listings")\
            .select("*")\
            .eq("is_active", True)\
            .execute()
        return jsonify(response.data), 200

@listings_bp.route('/listings/<listing_id>', methods=['GET'])
def get_listing(listing_id):
    response = supabase.table("listings").select("*").eq("id", listing_id).execute()
    if not response.data:
        return jsonify({"error": "Listing not found"}), 404
    return jsonify(response.data[0]), 200

@listings_bp.route('/listings', methods=['POST'])
def create_listing():
    data = request.json
    
    if not data:
        return jsonify({"error": "No data provided"}), 400

    required = ['owner_id', 'address', 'latitude', 'longitude', 'price_per_hour']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    listing = {
        "owner_id": data["owner_id"],
        "address": data["address"],
        "latitude": data["latitude"],
        "longitude": data["longitude"],
        "price_per_hour": data["price_per_hour"],
    }

    response = supabase.table("listings").insert(listing).execute()
    return jsonify(response.data), 201
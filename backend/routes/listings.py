from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

listings_bp = Blueprint('listings', __name__)

@listings_bp.route('/listings', methods=['GET'])
def get_all_listings():
    # Query parameters for availability check (optional)
    start_time = request.args.get('start_time')  # ISO 8601
    end_time = request.args.get('end_time')      # ISO 8601
    
    if start_time and end_time:
        # Time-range aware search: use RPC to exclude booked listings
        try:
            response = supabase.rpc("get_available_listings", {
                "p_start_time": start_time,
                "p_end_time": end_time
            }).execute()
            return jsonify(response.data), 200
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
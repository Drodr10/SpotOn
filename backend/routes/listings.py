from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

listings_bp = Blueprint('listings', __name__)

@listings_bp.route('/listings', methods=['GET'])
def get_all_listings():
    response = supabase.table("listings").select("*").execute()
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
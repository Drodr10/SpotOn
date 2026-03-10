from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

listings_bp = Blueprint('listings', __name__)

@listings_bp.route('/listings', methods=['GET'])
def get_all_listings():
    response = supabase.table("listings").select("*").execute()
    return jsonify(response.data), 200

@listings_bp.route('/listings', methods=['POST'])
def create_listing():
    data = request.json
    
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    response = supabase.table("listings").insert(data).execute()
    return jsonify(response.data), 201
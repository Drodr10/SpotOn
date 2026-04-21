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
    
    response = supabase.table("reservations").insert(data).execute()
    return jsonify(response.data), 201
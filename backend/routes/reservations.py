from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

reservations_bp = Blueprint('reservations', __name__)

@reservations_bp.route('/reservations', methods=['POST'])
def book_spot():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    response = supabase.table("reservations").insert(data).execute()
    return jsonify(response.data), 201
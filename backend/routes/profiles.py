from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

profiles_bp = Blueprint('profiles', __name__)

@profiles_bp.route('/profiles/<user_id>', methods=['GET'])
def get_profile(user_id):
    response = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    return jsonify(response.data), 200

@profiles_bp.route('/profiles/<user_id>', methods=['PUT'])
def update_profile(user_id):
    data = request.json
    response = supabase.table("profiles").update(data).eq("id", user_id).execute()
    return jsonify(response.data), 200
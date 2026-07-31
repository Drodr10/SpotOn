from flask import Blueprint, jsonify, request
from services.supabase_client import supabase
from services.auth import token_required

profiles_bp = Blueprint('profiles', __name__)

@profiles_bp.route('/profiles/<user_id>', methods=['GET'])
@token_required
def get_profile(current_user_id, user_id):
    if current_user_id != user_id:
        return jsonify({"error": "Forbidden: You can only access your own profile."}), 403

    response = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    return jsonify(response.data), 200

@profiles_bp.route('/profiles/<user_id>', methods=['PUT'])
@token_required
def update_profile(current_user_id, user_id):
    if current_user_id != user_id:
        return jsonify({"error": "Forbidden: You can only update your own profile."}), 403

    data = request.json
    response = supabase.table("profiles").update(data).eq("id", user_id).execute()
    return jsonify(response.data), 200
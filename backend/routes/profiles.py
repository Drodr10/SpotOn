from flask import Blueprint, jsonify, request
from services.supabase_client import supabase
from services.auth import token_required
from services.account_deletion import delete_account

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
    
    # Whitelist of fields that can be updated by the user
    allowed_fields = ['username', 'full_name', 'avatar_url']
    
    update_data = {key: data[key] for key in allowed_fields if key in data}

    if not update_data:
        return jsonify({"error": "No valid fields to update."}), 400

    response = supabase.table("profiles").update(update_data).eq("id", user_id).execute()
    return jsonify(response.data), 200


# Apple App Store Guideline 5.1.1(v): an app that lets users create an account
# must let them delete it in-app. See services/account_deletion.py for what
# "delete" means here and why it is not a literal DELETE.
@profiles_bp.route('/profiles/<user_id>', methods=['DELETE'])
@token_required
def delete_profile(current_user_id, user_id):
    if current_user_id != user_id:
        return jsonify({"error": "Forbidden: You can only delete your own account."}), 403

    try:
        result = delete_account(user_id)
    except Exception as err:  # noqa: BLE001 — never surface a raw driver error
        print(f"[profiles] account deletion failed for {user_id}: {err}")
        return jsonify({"error": "Could not delete your account. Please try again."}), 500

    if result.get("blockers"):
        # 409, not 400: the request is valid, the account just is not deletable yet.
        return jsonify({
            "error": "Your account can't be deleted yet.",
            "reasons": result["blockers"],
            "code": "deletion_blocked",
        }), 409

    return jsonify(result), 200

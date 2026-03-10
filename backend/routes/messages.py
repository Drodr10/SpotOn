from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

messages_bp = Blueprint('messages', __name__)

@messages_bp.route('/conversations/<user_id>', methods=['GET'])
def get_user_chats(user_id):
    # Get all chat rooms where the user is either the renter or the owner
    response = supabase.table("conversations")\
        .select("*, reservations(*), profiles!renter_id(*)")\
        .or_(f"renter_id.eq.{user_id},owner_id.eq.{user_id}")\
        .execute()
    return jsonify(response.data), 200

@messages_bp.route('/messages/<conv_id>', methods=['GET'])
def get_chat_history(conv_id):
    response = supabase.table("messages")\
        .select("*")\
        .eq("conversation_id", conv_id)\
        .order("sent_at", desc=False)\
        .execute()
    return jsonify(response.data), 200

@messages_bp.route('/messages', methods=['POST'])
def send_message():
    data = request.json
    response = supabase.table("messages").insert(data).execute()
    return jsonify(response.data), 201
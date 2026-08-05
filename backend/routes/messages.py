from flask import Blueprint, jsonify, request
from services.supabase_client import supabase
from services.auth import token_required

messages_bp = Blueprint('messages', __name__)

@messages_bp.route('/conversations/<user_id>', methods=['GET'])
@token_required
def get_user_chats(current_user_id, user_id):
    if current_user_id != user_id:
        return jsonify({"error": "Forbidden: You can only access your own conversations."}), 403
    # Get all chat rooms where the user is either the renter or the owner
    response = supabase.table("conversations")\
        .select("*, reservations(*), profiles!renter_id(*)")\
        .or_(f"renter_id.eq.{user_id},owner_id.eq.{user_id}")\
        .execute()
    return jsonify(response.data), 200

@messages_bp.route('/messages/<conv_id>', methods=['GET'])
@token_required
def get_chat_history(current_user_id, conv_id):
    # First, verify the user is part of this conversation
    conv_response = supabase.table("conversations").select("renter_id, owner_id").eq("id", conv_id).single().execute()
    if not conv_response.data:
        return jsonify({"error": "Conversation not found"}), 404
    
    conversation = conv_response.data
    if current_user_id not in [conversation['renter_id'], conversation['owner_id']]:
        return jsonify({"error": "Forbidden: You are not part of this conversation."}), 403

    response = supabase.table("messages")\
        .select("*")\
        .eq("conversation_id", conv_id)\
        .order("sent_at", desc=False)\
        .execute()
    return jsonify(response.data), 200

@messages_bp.route('/messages', methods=['POST'])
@token_required
def send_message(current_user_id):
    data = request.json
    
    conv_id = data.get('conversation_id')
    if not conv_id:
        return jsonify({"error": "conversation_id is required"}), 400

    # Verify the user is part of this conversation before allowing them to send a message
    conv_response = supabase.table("conversations").select("renter_id, owner_id").eq("id", conv_id).single().execute()
    if not conv_response.data:
        return jsonify({"error": "Conversation not found"}), 404
        
    conversation = conv_response.data
    if current_user_id not in [conversation['renter_id'], conversation['owner_id']]:
        return jsonify({"error": "Forbidden: You are not part of this conversation."}), 403

    message_data = {
        'conversation_id': conv_id,
        'sender_id': current_user_id,
        'content': data.get('content')
    }

    if not message_data['content']:
        return jsonify({"error": "Message content is required"}), 400

    response = supabase.table("messages").insert(message_data).execute()
    return jsonify(response.data), 201
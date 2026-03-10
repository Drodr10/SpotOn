from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/auth/signup', methods=['POST'])
def signup():
    data = request.json
    # Supabase Auth handles the secure credentials
    res = supabase.auth.sign_up({
        "email": data['email'],
        "password": data['password']
    })
    return jsonify({"user": res.user.id, "message": "Verification email sent!"}), 201

@auth_bp.route('/auth/login', methods=['POST'])
def login():
    data = request.json
    res = supabase.auth.sign_in_with_password({
        "email": data['email'],
        "password": data['password']
    })
    return jsonify({"session": res.session.access_token}), 200
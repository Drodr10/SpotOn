import os
from functools import wraps
from flask import request, jsonify
import jwt
from dotenv import load_dotenv


load_dotenv()
supabase_url = os.getenv("SUPABASE_URL")

if not supabase_url:
    raise RuntimeError("SUPABASE_URL environment variable not set.")

jwks_client = jwt.PyJWKClient(f"{supabase_url}/auth/v1/.well-known/jwks.json")

def token_required(f):
    """
    A decorator to verify the JWT token from the Authorization header.
    If the token is valid, it injects the user's ID (from the 'sub' claim)
    into the decorated function as the first argument.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = None
        if "Authorization" in request.headers:
            auth_header = request.headers["Authorization"]
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                token = parts[1]
            else:
                print("Authentication failed: Invalid Authorization header format. Use 'Bearer <token>'.")
                return jsonify({"error": "Invalid Authorization header format. Use 'Bearer <token>'."}), 401
        
        if not token:
            print("Authentication failed: Token is missing.")
            return jsonify({"error": "Unauthorized: Token is missing."}), 401

        try:
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            data = jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated")
            current_user_id = data.get('sub')
            if not current_user_id:
                print("Authentication failed: Invalid token: 'sub' claim missing.")
                return jsonify({"error": "Invalid token: 'sub' claim missing."}), 401

        except jwt.ExpiredSignatureError:
            print("Authentication failed: Token has expired.")
            return jsonify({"error": "Unauthorized: Token has expired."}), 401
        except jwt.InvalidTokenError as e:
            print(f"Authentication failed: Invalid token. {str(e)}")
            return jsonify({"error": f"Unauthorized: Invalid token. {str(e)}"}), 401

        # Pass the user ID to the decorated route function
        print(f"Successfully authenticated user: {current_user_id}")
        return f(current_user_id, *args, **kwargs)

    return decorated_function

from flask import Flask
from flask_cors import CORS
from routes.listings import listings_bp
from routes.reservations import reservations_bp
from routes.auth import auth_bp
from routes.profiles import profiles_bp
from routes.messages import messages_bp
from routes.stripe import stripe_bp

app = Flask(__name__)
CORS(app)

# Registering the full SpotOn suite
app.register_blueprint(listings_bp, url_prefix='/api')
app.register_blueprint(reservations_bp, url_prefix='/api')
app.register_blueprint(auth_bp, url_prefix='/api')
app.register_blueprint(profiles_bp, url_prefix='/api')
app.register_blueprint(messages_bp, url_prefix='/api')
app.register_blueprint(stripe_bp, url_prefix='/api')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
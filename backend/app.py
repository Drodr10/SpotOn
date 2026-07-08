import os
import threading
import time

from flask import Flask
from flask_cors import CORS
from routes.listings import listings_bp
from routes.reservations import reservations_bp
from routes.auth import auth_bp
from routes.profiles import profiles_bp
from routes.messages import messages_bp
from routes.stripe import stripe_bp
from routes.vehicles import vehicles_bp

app = Flask(__name__)
CORS(app)


# Fallback payout sweep scheduler. pg_cron (Supabase) is the primary trigger;
# enable this only if pg_cron is unavailable by setting ENABLE_SWEEP_SCHEDULER=true.
def _start_sweep_scheduler():
    from services.payouts import run_payout_sweep

    interval = int(os.getenv("SWEEP_INTERVAL_SECONDS", "900"))

    def _loop():
        while True:
            time.sleep(interval)
            try:
                summary = run_payout_sweep()
                print(f"[sweep] {summary}")
            except Exception as err:  # noqa: BLE001
                print(f"[sweep] error: {err}")

    threading.Thread(target=_loop, daemon=True).start()


# Only start in the worker process (avoid the Werkzeug reloader's parent).
if os.getenv("ENABLE_SWEEP_SCHEDULER", "false").lower() == "true" \
        and os.getenv("WERKZEUG_RUN_MAIN") != "false":
    _start_sweep_scheduler()

# Registering the full SpotOn suite
app.register_blueprint(listings_bp, url_prefix='/api')
app.register_blueprint(reservations_bp, url_prefix='/api')
app.register_blueprint(auth_bp, url_prefix='/api')
app.register_blueprint(profiles_bp, url_prefix='/api')
app.register_blueprint(messages_bp, url_prefix='/api')
app.register_blueprint(stripe_bp, url_prefix='/api')
app.register_blueprint(vehicles_bp, url_prefix='/api')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
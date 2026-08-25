import os

from flask import Flask, jsonify
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


# ── Payout sweep scheduler (APScheduler, in-process) ─────────────────────────
# Primary trigger for the session-ended / auto-refund sweep. Runs natively in
# the Flask process so it uses the same .env + code and logs to the terminal.
#
# IMPORTANT: this must run in exactly ONE process. Under gunicorn use a single
# worker (or set ENABLE_SWEEP_SCHEDULER=true on only one instance); otherwise
# each worker would run the sweep in parallel. The /api/stripe/run-payout-sweep
# endpoint remains available as a manual/backup trigger.
def _start_sweep_scheduler():
    from apscheduler.schedulers.background import BackgroundScheduler
    from services.payouts import run_payout_sweep
    from services.notifications import run_notification_sweep

    interval = int(os.getenv("SWEEP_INTERVAL_SECONDS", "900"))

    def _job():
        with app.app_context():
            try:
                payout_summary = run_payout_sweep()
                notification_summary = run_notification_sweep()
                print(f"[sweep] payouts={payout_summary} notifications={notification_summary}")
            except Exception as err:  # noqa: BLE001
                print(f"[sweep] error: {err}")

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(_job, trigger="interval", seconds=interval, id="payout_sweep")
    scheduler.start()
    print(f"[sweep] scheduler started (every {interval}s)")


# On by default; skip the Werkzeug reloader's parent process so the debug
# server doesn't start two schedulers.
if os.getenv("ENABLE_SWEEP_SCHEDULER", "true").lower() == "true" \
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

# ── Health check ─────────────────────────────────────────────────────────────
# Liveness only: deliberately does NOT touch Supabase or Stripe. A health check
# that depends on a third party turns their outage into a restart loop here,
# because the host restarts the service as soon as this stops returning 200.
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"}), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

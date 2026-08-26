import os
from flask import Blueprint, jsonify, request
from services.auth import token_required
from services.stripe_client import (
    publishableKey,
    create_booking_payment,
    release_booking_hold,
    finalize_booking,
    createConnectAccount,
    createAccountLink,
    sync_connect_account,
    handle_webhook,
    onboardingComplete,
)
from services.payouts import run_payout_sweep
from services.notifications import run_notification_sweep

stripe_bp = Blueprint('stripe', __name__)


@stripe_bp.route('/stripe/key', methods=['GET'])
def getKey():
    return jsonify({"publishableKey": publishableKey}), 200


# Atomically reserve the slot and start a platform-held payment for a booking.
# Funds are held on SpotOn's balance and transferred to the seller later.
@stripe_bp.route('/stripe/create-booking-payment', methods=['POST'])
@token_required
def create_booking_payment_route(current_user_id):
    data = request.json or {}
    required = ("listing_id", "vehicle_id", "start_time", "end_time")
    if not all(data.get(k) for k in required):
        return jsonify({"error": f"Missing required fields: {', '.join(required)}"}), 400
    return create_booking_payment(
        data["listing_id"], current_user_id, data["vehicle_id"],
        data["start_time"], data["end_time"],
    )


# Release a checkout hold early (renter dismissed the Stripe sheet). The sweep
# is the backstop, but releasing now frees the slot for others immediately.
#
# Authenticated: a hold_id alone used to be enough to drop anyone's slot
# mid-checkout. release_booking_hold scopes the delete to the caller.
@stripe_bp.route('/stripe/release-hold', methods=['POST'])
@token_required
def release_hold_route(current_user_id):
    data = request.json or {}
    return release_booking_hold(data.get("hold_id"), current_user_id)


# Client calls this the moment the payment sheet returns success, so the
# reservation exists immediately instead of waiting on the webhook (idempotent).
#
# Authenticated, and finalize_booking additionally checks the PaymentIntent
# belongs to the caller. Note a 401 here is a DEFERRED booking, not a lost one:
# if the session expired between paying and this call, the webhook still
# creates the reservation. Seeing these in the logs is not an emergency.
@stripe_bp.route('/stripe/finalize-booking', methods=['POST'])
@token_required
def finalize_booking_route(current_user_id):
    data = request.json or {}
    return finalize_booking(data.get("payment_intent_id"), current_user_id)


# Onboarding: create the seller's Express connected account (lazily, at payout setup).
@stripe_bp.route('/stripe/create-connect-account', methods=['POST'])
@token_required
def create_connect_account(current_user_id):
    return createConnectAccount(current_user_id)


# Onboarding: hosted Stripe onboarding link for the seller to finish KYC/bank setup.
@stripe_bp.route('/stripe/create-account-link', methods=['POST'])
@token_required
def create_account_link(current_user_id):
    return createAccountLink(current_user_id)


# Simple interstitial that immediately bounces the in-app browser back to the
# app via the deep link (nicer than a bare 302, and it renders past ngrok's free
# warning page once the user taps through).
def _deep_link_page(target: str, message: str = "Finishing up…"):
    html = f"""<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url={target}">
<title>Returning to SpotOn…</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding-top:20vh;color:#1E7D46;">
<p style="font-size:18px;">{message}</p>
<a href="{target}" style="color:#1E7D46;">Tap here if you're not redirected</a>
<script>window.location.replace("{target}");</script>
</body></html>"""
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@stripe_bp.route('/stripe/onboarding-complete', methods=['GET'])
def onboarding_return():
    # Backstop for the account.updated webhook: if the seller returned with
    # payouts enabled, release their pending reservations now even if the webhook
    # was missed. Best-effort — never block the redirect back into the app.
    user_id = request.args.get("user_id")
    if user_id:
        try:
            sync_connect_account(user_id)
        except Exception as err:  # noqa: BLE001
            print(f"[stripe] onboarding-complete sync failed for {user_id}: {err}")
    return _deep_link_page("spoton://Homescreen")


@stripe_bp.route('/stripe/onboarding-expired', methods=['GET'])
def onboarding_expired():
    return _deep_link_page("spoton://Homescreen")


# Client-invoked backstop: the app calls this after the onboarding browser closes
# so payouts sync immediately even if the webhook and the return redirect were
# both missed (idempotent with account.updated).
@stripe_bp.route('/stripe/sync-account', methods=['POST'])
@token_required
def sync_account_route(current_user_id):
    return sync_connect_account(current_user_id)


# Stripe -> SpotOn events: payment_intent.succeeded, account.updated, etc.
@stripe_bp.route('/stripe/webhook', methods=['POST'])
def stripe_webhook():
    return handle_webhook(request.get_data(), request.headers.get("Stripe-Signature", ""))


# Periodic housekeeping (invoked by pg_cron / the fallback scheduler).
# Guarded by a shared secret so it can't be triggered by arbitrary clients.
@stripe_bp.route('/stripe/run-payout-sweep', methods=['POST'])
def run_sweep():
    expected = os.getenv("SWEEP_SECRET")
    if not expected or request.headers.get("X-Sweep-Secret") != expected:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify(run_payout_sweep()), 200


@stripe_bp.route('/stripe/run-notification-sweep', methods=['POST'])
def run_notifications():
    expected = os.getenv("SWEEP_SECRET")
    if not expected or request.headers.get("X-Sweep-Secret") != expected:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify(run_notification_sweep()), 200

import os
import json
import stripe
from flask import jsonify
from dotenv import load_dotenv
from pathlib import Path

from services.supabase_client import supabase
from services.payouts import _parse_ts, release_pending_for_account
from utils.pricing import calculate_final_price, PricingError

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

publishableKey = os.getenv("STRIPE_PUBLISHABLE_KEY")
secretKey = os.getenv("STRIPE_SECRET_KEY")
backendUrl = os.getenv("BACKEND_URL")
webhookSecret = os.getenv("STRIPE_WEBHOOK_SECRET")

# Rate columns we hand to the pricing engine (incl. legacy fallback).
_RATE_COLS = "owner_id, hourly_rate, daily_rate, weekly_rate, monthly_rate, price_per_hour"

_PAYABLE_PI_STATES = {
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "processing",
}


def _to_cents(value) -> int:
    from decimal import Decimal, ROUND_HALF_UP
    cents = (Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def _fresh_customer_session(customer_id: str):
    return stripe.CustomerSession.create(
        customer=customer_id,
        components={"payment_element": {"enabled": True}},
    )


def _sheet_response(payment_intent_client_secret, customer_session_secret, customer_id, reservation_id):
    return jsonify(
        paymentIntent=payment_intent_client_secret,
        customerSessionClientSecret=customer_session_secret,
        customer=customer_id,
        reservationId=reservation_id,
        publishableKey=publishableKey,
    )


def create_booking_payment(listing_id: str, renter_id: str, vehicle_id: str,
                           start_time: str, end_time: str):
    """
    Atomically reserve the slot and start a platform-held payment.

    Unlike the old destination-charge flow, this creates a PaymentIntent on the
    SpotOn platform (no transfer_data / application_fee) so the funds are held on
    our balance. The reservation is created FIRST (status pending / payout_status
    pending_payment) so a charge can never exist without a reservation row.

    Idempotent: if the same renter already has a pending_payment reservation for
    the exact same slot, we reuse it and its PaymentIntent instead of creating a
    duplicate (prevents double-booking on checkout re-inits/retries).
    """
    stripe.api_key = secretKey

    # ── Price + owner (authoritative, server-side) ──────────────────────────
    listing = (
        supabase.table("listings").select(_RATE_COLS).eq("id", listing_id).single().execute().data
    )
    if not listing:
        return jsonify({"error": "Listing not found"}), 404
    owner_id = listing.get("owner_id")

    try:
        breakdown = calculate_final_price(listing, start_time, end_time)
    except PricingError as pe:
        return jsonify({"error": str(pe)}), 400
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Pricing error: {str(e)}"}), 500

    total_cents = _to_cents(breakdown["total"])
    start_dt, end_dt = _parse_ts(start_time), _parse_ts(end_time)

    # ── Idempotency: reuse an in-flight pending_payment reservation ─────────
    existing_rows = (
        supabase.table("reservations")
        .select("*")
        .eq("listing_id", listing_id)
        .eq("renter_id", renter_id)
        .eq("payout_status", "pending_payment")
        .execute()
        .data
    ) or []
    reused = next(
        (r for r in existing_rows
         if _parse_ts(r["start_time"]) == start_dt and _parse_ts(r["end_time"]) == end_dt),
        None,
    )

    reservation_id = None
    if reused:
        reservation_id = reused["id"]
        pi_id = reused.get("stripe_payment_intent")
        if pi_id:
            try:
                pi = stripe.PaymentIntent.retrieve(pi_id)
                if pi.status in _PAYABLE_PI_STATES:
                    session = _fresh_customer_session(pi.customer)
                    return _sheet_response(pi.client_secret, session.client_secret, pi.customer, reservation_id)
            except Exception:  # noqa: BLE001 - fall through and mint a new PI
                pass

    # ── Otherwise create the reservation (RPC handles overlap + conversation) ─
    if not reservation_id:
        try:
            result = supabase.rpc("create_reservation_with_conversation", {
                "p_listing_id": listing_id,
                "p_renter_id": renter_id,
                "p_owner_id": owner_id,
                "p_vehicle_id": vehicle_id,
                "p_start_time": start_time,
                "p_end_time": end_time,
                "p_total_price": str(breakdown["total"]),
                "p_platform_fee": str(breakdown["platform_fee"]),
                "p_host_payout": str(breakdown["host_payout"]),
            }).execute()
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"Database error: {str(e)}"}), 500

        row = result.data[0] if result.data else {}
        if row.get("error_message"):
            return jsonify({"error": row["error_message"]}), 409
        reservation_id = row.get("reservation_id")
        if not reservation_id:
            return jsonify({"error": "Failed to create reservation"}), 500

    # ── Platform-held PaymentIntent (no transfer_data / application_fee) ─────
    try:
        customer = stripe.Customer.create()
        session = _fresh_customer_session(customer.id)
        payment_intent = stripe.PaymentIntent.create(
            amount=total_cents,
            currency="usd",
            customer=customer.id,
            automatic_payment_methods={"enabled": True},
            transfer_group=str(reservation_id),
            metadata={"reservation_id": str(reservation_id), "seller_id": str(owner_id)},
        )
        supabase.table("reservations").update(
            {"stripe_payment_intent": payment_intent.id}
        ).eq("id", reservation_id).execute()
    except Exception as e:  # noqa: BLE001
        # Roll back the freshly created reservation so the slot isn't locked.
        if not reused:
            supabase.table("reservations").update(
                {"status": "cancelled", "payout_status": "cancelled"}
            ).eq("id", reservation_id).execute()
        return jsonify({"error": f"Payment setup failed: {str(e)}"}), 500

    return _sheet_response(payment_intent.client_secret, session.client_secret, customer.id, reservation_id)


def createConnectAccount(user_id: str):
    """Create the seller's Express connected account (transfers capability only)."""
    stripe.api_key = secretKey
    try:
        profile_data = (
            supabase.table("profiles").select("email, stripe_account_id").eq("id", user_id).single().execute().data
        )
        if not profile_data:
            return jsonify({"error": "User profile not found"}), 404
        if profile_data.get("stripe_account_id"):
            return jsonify({"account_id": profile_data["stripe_account_id"]})

        user_email = profile_data.get("email")
        if not user_email:
            return jsonify({"error": "User email not found in profile"}), 400

        account = stripe.Account.create(
            type="express",
            country="US",
            email=user_email,
            capabilities={"transfers": {"requested": True}},
        )
        # Persist immediately so we never orphan an account if the client drops.
        supabase.table("profiles").update(
            {"stripe_account_id": account.id}
        ).eq("id", user_id).execute()
        return jsonify({"account_id": account.id})
    except Exception as err:  # noqa: BLE001
        print(f"Error creating Stripe Connect account: {str(err)}")
        return jsonify({"error": str(err)}), 500


def createAccountLink(user_id: str):
    """Generate a hosted Stripe onboarding link for the seller's account."""
    stripe.api_key = secretKey
    try:
        profile_data = (
            supabase.table("profiles").select("stripe_account_id").eq("id", user_id).single().execute().data
        )
        account_id = profile_data.get("stripe_account_id") if profile_data else None
        if not account_id:
            return jsonify({"error": "Stripe account ID not found for this user. Please create an account first."}), 404

        return_url = f"https://{backendUrl}/api/stripe/onboarding-complete"
        refresh_url = f"https://{backendUrl}/api/stripe/onboarding-expired"

        account_link = stripe.AccountLink.create(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
        return jsonify({"account_link_url": account_link.url})
    except Exception as err:  # noqa: BLE001
        print(f"Error creating account link: {str(err)}")
        return jsonify({"error": str(err)}), 500


# ── Webhooks ────────────────────────────────────────────────────────────────
def handle_webhook(payload: bytes, sig_header: str):
    stripe.api_key = secretKey
    try:
        if webhookSecret:
            event = stripe.Webhook.construct_event(payload, sig_header, webhookSecret)
        else:
            # Dev fallback only — set STRIPE_WEBHOOK_SECRET in production.
            print("[stripe] WARNING: STRIPE_WEBHOOK_SECRET unset; skipping signature check")
            event = json.loads(payload)
    except (ValueError, stripe.error.SignatureVerificationError) as err:
        return jsonify({"error": f"Webhook verification failed: {str(err)}"}), 400

    event_type = event["type"]
    obj = event["data"]["object"]

    if event_type == "payment_intent.succeeded":
        _on_payment_succeeded(obj)
    elif event_type == "account.updated":
        _on_account_updated(obj)
    elif event_type in ("transfer.created", "charge.refunded"):
        print(f"[stripe] {event_type}: {obj.get('id')}")  # bookkeeping / logs

    return jsonify({"received": True}), 200


def _on_payment_succeeded(pi: dict):
    charge = pi.get("latest_charge")
    supabase.table("reservations").update(
        {"stripe_charge_id": charge, "payout_status": "held", "status": "confirmed"}
    ).eq("stripe_payment_intent", pi["id"]).eq("payout_status", "pending_payment").execute()
    print(f"[stripe] payment succeeded for PI {pi['id']} (charge {charge}) -> held")


def _on_account_updated(account: dict):
    account_id = account.get("id")
    if account.get("payouts_enabled"):
        moved = release_pending_for_account(account_id)
        print(f"[stripe] account {account_id} payouts_enabled -> released {moved} transfer(s)")
    else:
        supabase.table("profiles").update({"payouts_enabled": False}).eq(
            "stripe_account_id", account_id
        ).execute()

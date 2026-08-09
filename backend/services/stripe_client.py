import os
import json
import random
import re
import time
import traceback
import stripe
from flask import jsonify
from dotenv import load_dotenv
from pathlib import Path

from services.supabase_client import supabase
from services.payouts import _parse_ts, release_pending_for_account
from services.notifications import send_booking_notifications
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


def _sheet_response(payment_intent_client_secret, customer_session_secret, customer_id, hold_id=None):
    return jsonify(
        paymentIntent=payment_intent_client_secret,
        customerSessionClientSecret=customer_session_secret,
        customer=customer_id,
        holdId=hold_id,
        publishableKey=publishableKey,
    )


# Minutes a Reserve-press hold stays valid before the sweep frees the slot.
HOLD_TTL_MINUTES = 5


def _reservation_validation_error(listing_id: str, start_time: str, end_time: str):
    """Ask the DATABASE whether this reservation may exist — before charging.

    Calls the same reservation_validation_error() that the BEFORE INSERT trigger
    raises, so this pre-charge check cannot drift from the enforcement. That
    drift is precisely what charged a renter $331.20 for a booking the trigger
    then refused (see migration 20260730005125).

    Returns the reason string, or None when the booking is allowed. Failure to
    REACH the check also returns None, deliberately: the trigger is still the
    backstop, and refusing every booking because a speculative query failed
    would be worse than falling through to it.
    """
    try:
        result = supabase.rpc("reservation_validation_error", {
            "p_listing_id": listing_id,
            "p_start_time": start_time,
            "p_end_time": end_time,
        }).execute()
    except Exception as err:  # noqa: BLE001
        print(f"[stripe] pre-charge validation unavailable for {listing_id}: {err}")
        return None
    reason = getattr(result, "data", None)
    if isinstance(reason, list):
        reason = reason[0] if reason else None
    if isinstance(reason, dict):  # some client versions wrap scalar returns
        reason = next(iter(reason.values()), None)
    return reason or None


# SQLSTATEs that mean "this reservation can never be created", as opposed to
# "try again later". P0001 is a deliberate RAISE from our own triggers (a
# business rule); class 23 are integrity violations (unique, FK, exclusion).
# Both are terminal, so a payment already captured against one must be refunded
# rather than left for someone to notice in a log. Anything else — a dropped
# connection, an empty RPC response, an unhandled crash — may succeed on the
# webhook's retry, and refunding it would cancel a booking about to work.
_TERMINAL_ERROR_PREFIXES = ("slot_unavailable", "missing_metadata")


# Class 40 is "transaction rollback" — 40P01 deadlock_detected, 40001
# serialization_failure. These mean "your transaction lost a race and was rolled
# back", which is genuinely retryable: the same call usually succeeds moments
# later. They are handled by re-calling the RPC (see _FINALIZE_MAX_ATTEMPTS
# below), not by classification.
_RETRYABLE_DB_ERROR = re.compile(r"^db_40[0-9A-Z]{3}:")

# How many times to re-call finalize_paid_reservation on a class-40 error.
# Deliberately small and fast: this runs inside a Stripe webhook handler, which
# wants a prompt ACK, and deadlocks resolve the instant the victim rolls back.
# Too generous and Stripe times out and retries the whole webhook on top of us.
_FINALIZE_MAX_ATTEMPTS = 3
_FINALIZE_RETRY_DELAY = (0.05, 0.15)  # jittered, so two racers don't re-collide


def _is_terminal_finalize_error(message: str) -> bool:
    if not message:
        return False
    if message.startswith(_TERMINAL_ERROR_PREFIXES):
        return True
    # SQLSTATEs are 5 alphanumeric chars, not 5 digits: class 23 includes 23505
    # (unique), 23503 (FK) AND 23P01 (exclusion — the double-booking one), so a
    # \d{3} tail silently missed exactly the case that matters most here.
    if re.match(r"^db_(P0001|23[0-9A-Z]{3}):", message):
        return True
    # A class-40 error only reaches classification once the retries above are
    # exhausted. Treat it as terminal at that point: the renter's money must not
    # depend on a later retry that nothing performs. Nothing re-drives a
    # non-terminal failure — the webhook ACKs 200 regardless and there is no
    # reconciliation sweep — so "retryable" here means "silently stranded".
    return bool(_RETRYABLE_DB_ERROR.match(message))


def _refund_stranded_payment(payment_intent_id: str, reason: str) -> str:
    """Refund a captured payment whose reservation could not be created.

    The renter's money must not depend on someone reading a log line. Idempotent
    two ways: an existing refund short-circuits, and the create call carries an
    idempotency key, so the client path and the webhook path racing each other
    cannot double-refund.

    Stripe's refund `reason` enum has no "our bug" member; requested_by_customer
    is the conventional choice for a merchant-initiated make-good, and the real
    cause rides in metadata for reconciliation.
    """
    if not payment_intent_id:
        return "no_payment_intent"
    try:
        existing = stripe.Refund.list(payment_intent=payment_intent_id, limit=1)
        if getattr(existing, "data", None):
            return "already_refunded"
        stripe.Refund.create(
            payment_intent=payment_intent_id,
            reason="requested_by_customer",
            metadata={"spoton_refund_cause": str(reason)[:400]},
            idempotency_key=f"spoton-stranded-{payment_intent_id}",
        )
        return "refunded"
    except Exception as err:  # noqa: BLE001 — the original failure still wins
        print(f"[stripe] REFUND FAILED for {payment_intent_id} ({reason}): {err}")
        traceback.print_exc()
        return "refund_failed"


# Raw SQLSTATE strings must never reach a renter's screen. finalize's catch-all
# formats DB failures as 'db_<SQLSTATE>: <SQLERRM>', which is how a customer ended
# up reading "db_P0001: Daily bookings not supported for this listing" in a dialog.
# P0001 is merely "a trigger of ours raised" — the text after it IS ours and is
# human, so it can be surfaced; class-23 messages are Postgres internals about
# constraint names and never can be.
_OUR_RAISE = re.compile(r"^db_P0001:\s*(.+)$", re.S)
_CONSTRAINT_VIOLATION = re.compile(r"^db_23[0-9A-Z]{3}:")


def _finalize_reason(error: str) -> str:
    """One clause naming what went wrong, in words a renter understands."""
    if not error:
        return "We could not create your reservation."
    if error.startswith("slot_unavailable") or _CONSTRAINT_VIOLATION.match(error):
        return "That spot was just booked by someone else."
    if error.startswith("missing_metadata"):
        return "We lost track of this booking's details."
    ours = _OUR_RAISE.match(error)
    if ours:
        reason = ours.group(1).strip()
        return reason if reason.endswith(".") else reason + "."
    return "We could not create your reservation."


def _finalize_user_message(error: str, *, refunded: bool | None) -> str:
    """The whole message shown to the renter.

    refunded=None means the failure is RETRYABLE: the payment stands and the
    webhook will finish the booking, so telling the user anything alarming (or
    inviting them to pay again) would be wrong.
    """
    if refunded is None:
        return (
            "Your payment went through and we're still confirming this booking. "
            "It should appear in your reservations shortly — please don't pay again."
        )
    reason = _finalize_reason(error)
    if refunded:
        return f"{reason} You have not been charged — the payment was refunded."
    return (
        f"{reason} We could not issue the refund automatically, so please contact "
        "support and we'll return the payment."
    )


def create_booking_payment(listing_id: str, renter_id: str, vehicle_id: str,
                           start_time: str, end_time: str):
    """
    Hold-and-confirm checkout. Called when the renter presses Reserve.

    1. Acquire a short-lived hold on the slot (reservation_holds). If another
       renter is already checking out an overlapping slot — or it's already
       booked — this returns 409 {code: slot_unavailable} and no PaymentIntent
       is created.
    2. Create a platform-held PaymentIntent carrying the booking details in
       metadata. The real reservation row is NOT created here — it is created by
       the payment_intent.succeeded webhook (finalize_paid_reservation), so an
       abandoned checkout never leaves a reservation behind. The hold self-expires
       via the sweep after HOLD_TTL_MINUTES.
    """
    stripe.api_key = secretKey

    # ── Price + owner (authoritative, server-side) ──────────────────────────
    listing = (
        supabase.table("listings").select(_RATE_COLS).eq("id", listing_id).single().execute().data
    )
    if not listing:
        return jsonify({"error": "Listing not found"}), 404
    owner_id = listing.get("owner_id")

    if renter_id == owner_id:
        return jsonify({"error": "You can't reserve your own listing.", "code": "self_booking"}), 400

    # Refuse anything the DB would refuse, BEFORE any money moves. Same function
    # the insert trigger enforces, so a rule can never reject a booking only
    # after the renter's card has been charged.
    blocked = _reservation_validation_error(listing_id, start_time, end_time)
    if blocked:
        return jsonify({"error": blocked, "code": "invalid_booking"}), 400

    try:
        breakdown = calculate_final_price(listing, start_time, end_time)
    except PricingError as pe:
        return jsonify({"error": str(pe)}), 400
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Pricing error: {str(e)}"}), 500

    total_cents = _to_cents(breakdown["total"])

    # ── Acquire the slot hold (atomic, per-listing serialized) ──────────────
    try:
        hold_result = supabase.rpc("acquire_booking_hold", {
            "p_listing_id": listing_id,
            "p_renter_id": renter_id,
            "p_vehicle_id": vehicle_id,
            "p_start_time": start_time,
            "p_end_time": end_time,
            "p_ttl_minutes": HOLD_TTL_MINUTES,
        }).execute()
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Database error: {str(e)}"}), 500

    hold_row = hold_result.data[0] if hold_result.data else {}
    hold_error = hold_row.get("error_message")
    if hold_error == "slot_unavailable":
        return jsonify({
            "error": "This spot is being booked right now. Try again in a few minutes.",
            "code": "slot_unavailable",
        }), 409
    if hold_error:
        # acquire_booking_hold now also refuses bookings outside the listing's
        # availability window and ones starting in the past, and returns the
        # reason as text. Surface it: falling through to the generic 500 below
        # would tell the renter "Could not hold this slot" when the real answer
        # is "this spot isn't available until March 3rd".
        return jsonify({"error": hold_error, "code": "invalid_booking"}), 400
    hold_id = hold_row.get("hold_id")
    if not hold_id:
        return jsonify({"error": "Could not hold this slot"}), 500

    # ── Platform-held PaymentIntent (reservation created later, on success) ──
    try:
        customer = stripe.Customer.create()
        session = _fresh_customer_session(customer.id)
        payment_intent = stripe.PaymentIntent.create(
            amount=total_cents,
            currency="usd",
            customer=customer.id,
            automatic_payment_methods={"enabled": True},
            metadata={
                "hold_id": str(hold_id),
                "listing_id": str(listing_id),
                "renter_id": str(renter_id),
                "vehicle_id": str(vehicle_id),
                "seller_id": str(owner_id),
                "start_time": start_time,
                "end_time": end_time,
                "total_price": str(breakdown["total"]),
                "platform_fee": str(breakdown["platform_fee"]),
                "host_payout": str(breakdown["host_payout"]),
            },
        )
    except Exception as e:  # noqa: BLE001
        # Free the hold so the slot isn't stuck until TTL if setup failed.
        _delete_hold(hold_id)
        return jsonify({"error": f"Payment setup failed: {str(e)}"}), 500

    return _sheet_response(payment_intent.client_secret, session.client_secret, customer.id, hold_id)


def _delete_hold(hold_id: str):
    try:
        supabase.table("reservation_holds").delete().eq("id", hold_id).execute()
    except Exception as err:  # noqa: BLE001
        print(f"[stripe] failed to delete hold {hold_id}: {err}")


def release_booking_hold(hold_id: str):
    """Free a hold immediately (e.g. the renter dismissed the payment sheet)."""
    if hold_id:
        _delete_hold(hold_id)
    return jsonify({"released": True}), 200


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

        # Carry the user id back so onboarding-complete can sync payouts even if
        # the account.updated webhook was missed or failed.
        return_url = f"https://{backendUrl}/api/stripe/onboarding-complete?user_id={user_id}"
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

    # A handler crash must never 500 the webhook — Stripe would keep retrying and
    # (for account.updated) the seller would stay un-enabled. Swallow + log so the
    # endpoint always ACKs 200; the onboarding-complete backstop covers misses.
    try:
        if event_type == "payment_intent.succeeded":
            _on_payment_succeeded(obj)
        elif event_type == "account.updated":
            _on_account_updated(obj)
        elif event_type in ("transfer.created", "charge.refunded"):
            oid = _to_plain_dict(obj).get("id") if not isinstance(obj, dict) else obj.get("id")
            print(f"[stripe] {event_type}: {oid}")  # bookkeeping / logs
    except Exception as err:  # noqa: BLE001
        print(f"[stripe] webhook handler for {event_type} crashed: {err}")
        traceback.print_exc()

    return jsonify({"received": True}), 200


def _to_plain_dict(obj):
    """
    Normalize a Stripe StripeObject (or nested StripeObject) into plain dicts.
    Needed because in some Stripe SDK versions, StripeObject.__getattr__ treats
    method names like `.get` as key lookups and raises AttributeError. Working
    with a plain dict sidesteps that entirely.
    """
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    # stripe.util.convert_to_dict exists across versions; fall back to
    # `to_dict_recursive` / `to_dict` / json round-trip.
    for meth in ("to_dict_recursive", "to_dict"):
        fn = getattr(obj, meth, None)
        if callable(fn):
            try:
                return fn()
            except Exception:  # noqa: BLE001
                pass
    try:
        return json.loads(str(obj))
    except Exception:  # noqa: BLE001
        try:
            return dict(obj)
        except Exception:  # noqa: BLE001
            return obj


def _num(value, default=0.0) -> float:
    """Coerce metadata (which Stripe stores as strings) to a real number."""
    if value is None or value == "":
        return float(default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _finalize_reservation_from_pi(pi) -> dict:
    """
    Create the real reservation from a succeeded PaymentIntent's metadata
    (set in create_booking_payment). Idempotent on the PaymentIntent id, so it's
    safe to run from BOTH the webhook and the client's post-payment call. The
    renter's hold is released by finalize_paid_reservation.

    Returns {"reservation_id": str} on success or {"error": str}.
    """
    try:
        # Stripe's StripeObject shadows dict methods like .get in some SDK
        # versions — flatten to a plain dict first so downstream code is safe.
        pi_dict = _to_plain_dict(pi) if not isinstance(pi, dict) else pi
        md = pi_dict.get("metadata") or {}
        if not isinstance(md, dict):
            md = _to_plain_dict(md) or {}
        raw_charge = pi_dict.get("latest_charge")
        if isinstance(raw_charge, dict):
            charge = raw_charge.get("id")
        else:
            charge = raw_charge  # str id, or None
        pi_id = pi_dict.get("id")

        required = ("listing_id", "renter_id", "vehicle_id", "start_time", "end_time")
        missing = [k for k in required if not md.get(k)]
        if missing:
            return {"error": f"missing_metadata: {','.join(missing)}"}

        params = {
            "p_listing_id": str(md["listing_id"]),
            "p_renter_id": str(md["renter_id"]),
            "p_vehicle_id": str(md["vehicle_id"]),
            "p_start_time": str(md["start_time"]),
            "p_end_time": str(md["end_time"]),
            "p_total_price": _num(md.get("total_price")),
            "p_platform_fee": _num(md.get("platform_fee")),
            "p_host_payout": _num(md.get("host_payout")),
            "p_payment_intent": str(pi_id),
            "p_charge_id": str(charge) if charge else None,
        }

        # Retry on class-40 (deadlock / serialization) failures.
        #
        # Two renters racing OVERLAPPING — not identical — ranges on one listing
        # both reach a succeeded payment, and both call this. Measured against
        # the real function over 30 concurrent trials, the loser came back
        # 'slot_unavailable' half the time and 'db_40P01: deadlock detected' the
        # other half. Only the first is terminal, so half of all losing renters
        # were charged, given no reservation, and never refunded — recoverable
        # only by a human reading a log line.
        #
        # Retrying is the right response rather than reclassifying, because it
        # produces the correct outcome for BOTH racers instead of just refunding
        # more people: on the retry one renter wins the slot and the other gets a
        # clean exclusion violation, which is already terminal and already
        # refunds. It also fixes the milder case where the client and the webhook
        # deadlock over the SAME payment — the retry finds the row the other one
        # just created (finalize_paid_reservation checks stripe_payment_intent
        # before inserting, so this is safe) and returns success, instead of
        # showing the renter "charged, contact support" for a booking that exists.
        #
        # Both callers — the webhook and the client-invoked finalize — come
        # through here, so one retry site covers both.
        for attempt in range(1, _FINALIZE_MAX_ATTEMPTS + 1):
            try:
                result = supabase.rpc("finalize_paid_reservation", params).execute()
            except Exception as err:  # noqa: BLE001
                print(f"[stripe] finalize_paid_reservation RPC raised: {err}")
                traceback.print_exc()
                return {"error": f"db_error: {err}"}

            data = getattr(result, "data", None)
            print(f"[stripe] finalize_paid_reservation returned data={data!r}")

            if not data:
                return {"error": "rpc_empty_response"}

            # RETURNS TABLE → list of rows; occasionally scalar depending on client.
            row = data[0] if isinstance(data, list) else data
            if not isinstance(row, dict):
                return {"error": f"rpc_unexpected_shape: {type(row).__name__}"}

            error_message = row.get("error_message")
            if error_message:
                if (_RETRYABLE_DB_ERROR.match(error_message)
                        and attempt < _FINALIZE_MAX_ATTEMPTS):
                    print(f"[stripe] finalize attempt {attempt} lost a race "
                          f"({error_message}); retrying")
                    time.sleep(random.uniform(*_FINALIZE_RETRY_DELAY))
                    continue
                # Either terminal, or class-40 with no attempts left — in which
                # case _is_terminal_finalize_error now treats it as terminal so
                # the capture is refunded rather than silently stranded.
                return {"error": error_message}
            break

        rid = row.get("reservation_id")
        if not rid:
            return {"error": "rpc_no_reservation_id"}
        try:
            sent = send_booking_notifications(str(rid))
            print(f"[stripe] booking notifications for reservation {rid}: {sent}")
        except Exception as err:  # noqa: BLE001
            print(f"[stripe] booking notification failed for reservation {rid}: {err}")
        return {"reservation_id": rid}
    except Exception as err:  # noqa: BLE001 — never let this bubble to Flask as a 500
        print(f"[stripe] _finalize_reservation_from_pi crashed: {err}")
        traceback.print_exc()
        return {"error": f"finalize_crashed: {err}"}


def _on_payment_succeeded(pi: dict):
    """Webhook path — reliable backstop that creates the reservation on payment."""
    outcome = _finalize_reservation_from_pi(pi)
    error = outcome.get("error")
    if error and _is_terminal_finalize_error(error):
        # Terminal: the reservation can never be created, so the capture must not
        # stand. Refund instead of leaving it for manual review (this is the
        # "refund-on-conflict" that used to be deferred here).
        disposition = _refund_stranded_payment(pi.get("id"), error)
        print(f"[stripe] payment {pi.get('id')} could not be booked ({error}) "
              f"-> refund {disposition}")
    elif error:
        # Non-terminal: may succeed on a later retry. Refunding here would cancel
        # a booking that is about to work, so stay loud instead.
        print(f"[stripe] WARNING payment {pi.get('id')} succeeded but reservation "
              f"not created ({error}); retryable — needs review if it persists")
    else:
        print(f"[stripe] payment succeeded for PI {pi['id']} -> reservation {outcome['reservation_id']} (held)")


def finalize_booking(payment_intent_id: str):
    """
    Client-invoked finalize, called the instant the payment sheet returns
    success. Confirms the PaymentIntent really succeeded, then creates the
    reservation. Idempotent with the webhook — whichever runs first wins, the
    other is a no-op. Makes booking work even if `stripe listen` isn't forwarding.
    """
    stripe.api_key = secretKey
    if not payment_intent_id:
        return jsonify({"error": "Missing payment_intent_id"}), 400
    try:
        pi_obj = stripe.PaymentIntent.retrieve(payment_intent_id, expand=["latest_charge"])
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return jsonify({"error": f"Could not retrieve payment: {e}"}), 502

    pi = _to_plain_dict(pi_obj) if not isinstance(pi_obj, dict) else pi_obj
    if pi.get("status") != "succeeded":
        return jsonify({"error": "Payment not completed", "status": pi.get("status")}), 409

    try:
        outcome = _finalize_reservation_from_pi(pi)
    except Exception as e:  # noqa: BLE001 — belt-and-suspenders so nothing becomes an HTML 500
        traceback.print_exc()
        return jsonify({"error": f"finalize_unhandled: {e}"}), 500

    if outcome.get("error"):
        error = outcome["error"]
        # 409 signals "payment fine, reservation could not be created". Every
        # branch returns a `message` fit to display and keeps the raw string in
        # `detail` for logs and support — the UI should never render a SQLSTATE.
        if _is_terminal_finalize_error(error):
            disposition = _refund_stranded_payment(pi.get("id"), error)
            refunded = disposition in ("refunded", "already_refunded")
            return jsonify({
                "detail": error,
                "refunded": refunded,
                "refund_status": disposition,
                "message": _finalize_user_message(error, refunded=refunded),
            }), 409
        # Retryable: the webhook will finish this booking, so the payment stands.
        return jsonify({
            "detail": error,
            "refunded": False,
            "refund_status": "retryable",
            "message": _finalize_user_message(error, refunded=None),
        }), 409
    return jsonify({"reservationId": outcome["reservation_id"]}), 200


def _on_account_updated(account):
    """
    Webhook path for Connect account changes. The event object is a StripeObject
    whose `.get` can raise AttributeError in some SDK versions (same bug already
    fixed for PaymentIntents) — flatten to a plain dict before reading fields, and
    never let this bubble up as a 500 (the endpoint must ACK so Stripe stops
    retrying; the onboarding-complete backstop covers any miss).
    """
    try:
        acct = _to_plain_dict(account) if not isinstance(account, dict) else account
        account_id = acct.get("id")
        if not account_id:
            print("[stripe] account.updated missing account id; skipping")
            return
        if acct.get("payouts_enabled"):
            moved = release_pending_for_account(account_id)
            print(f"[stripe] account {account_id} payouts_enabled -> released {moved} transfer(s)")
        else:
            supabase.table("profiles").update({"payouts_enabled": False}).eq(
                "stripe_account_id", account_id
            ).execute()
    except Exception as err:  # noqa: BLE001 — never 500 the webhook endpoint
        print(f"[stripe] _on_account_updated crashed: {err}")
        traceback.print_exc()


def sync_connect_account(user_id: str):
    """
    Backstop for the account.updated webhook (mirrors finalize_booking): when the
    seller returns from hosted onboarding, pull their Connect account straight
    from Stripe and, if payouts are now enabled, release their payout_ready
    reservations. Idempotent with the webhook — whichever runs first wins.
    """
    stripe.api_key = secretKey
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 400

    try:
        profile = (
            supabase.table("profiles").select("stripe_account_id").eq("id", user_id).single().execute().data
        )
    except Exception as err:  # noqa: BLE001
        traceback.print_exc()
        return jsonify({"error": f"profile_lookup_failed: {err}"}), 500

    account_id = (profile or {}).get("stripe_account_id")
    if not account_id:
        return jsonify({"payouts_enabled": False, "released": 0}), 200

    try:
        account = stripe.Account.retrieve(account_id)
    except Exception as err:  # noqa: BLE001
        traceback.print_exc()
        return jsonify({"error": f"account_retrieve_failed: {err}"}), 502

    acct = _to_plain_dict(account) if not isinstance(account, dict) else account
    if acct.get("payouts_enabled"):
        moved = release_pending_for_account(account_id)
        print(f"[stripe] sync: account {account_id} payouts_enabled -> released {moved} transfer(s)")
        return jsonify({"payouts_enabled": True, "released": moved}), 200

    # Not enabled yet — keep the flag accurate but leave reservations pending.
    supabase.table("profiles").update({"payouts_enabled": False}).eq("id", user_id).execute()
    return jsonify({"payouts_enabled": False, "released": 0}), 200

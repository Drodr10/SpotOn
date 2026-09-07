"""
Payout engine for SpotOn's deferred-onboarding marketplace.

Money model (separate charges & transfers):
  - A buyer's payment lands on SpotOn's PLATFORM balance (no transfer_data).
  - We record the debt on the reservation (host_payout + charge id).
  - Once the session has ended AND the seller has completed Stripe onboarding,
    we create a Transfer (with source_transaction) to the seller's connected
    account. Our fee is simply what we don't transfer (total - host_payout).

This module owns the state transitions after a payment succeeds:
    held -> payout_ready -> paid_out   (happy path)
    payout_ready -> refunded           (seller never onboards within 30 days)
    pending_payment -> cancelled       (checkout abandoned; frees the slot)
"""

import os
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP

import stripe
import requests
from flask import jsonify

from services.supabase_client import supabase

# ── Tunables ────────────────────────────────────────────────────────────────
HOLD_WINDOW_DAYS = 30            # auto-refund the buyer if unclaimed this long
PENDING_EXPIRY_MINUTES = 30      # abandoned checkout -> cancel to free the slot
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Renter-initiated cancellation must land at least this many hours before the
# booking's start_time. Kept as an env var (not a code constant) so the window
# can change without a redeploy — read fresh on every call, not cached at
# import time, so a Render env var edit takes effect on the next request.
CANCELLATION_WINDOW_HOURS_DEFAULT = 24


# ── Small helpers ───────────────────────────────────────────────────────────
def _to_cents(value) -> int:
    if value is None:
        return 0
    cents = (Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def _parse_ts(value) -> datetime:
    """Parse a Supabase ISO timestamp into an aware UTC datetime."""
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _seller_profile_for_reservation(res: dict):
    """Return the listing owner's profile row (payout identity) for a reservation."""
    listing = (
        supabase.table("listings")
        .select("owner_id")
        .eq("id", res["listing_id"])
        .single()
        .execute()
        .data
    )
    if not listing or not listing.get("owner_id"):
        return None
    return (
        supabase.table("profiles")
        .select("id, email, stripe_account_id, payouts_enabled, expo_push_token")
        .eq("id", listing["owner_id"])
        .single()
        .execute()
        .data
    )


def send_push(token: str, title: str, body: str, data: dict | None = None):
    """Fire-and-forget Expo push. Never raises into the caller."""
    if not token:
        return
    try:
        requests.post(
            EXPO_PUSH_URL,
            json={"to": token, "title": title, "body": body, "data": data or {}},
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
    except Exception as err:  # noqa: BLE001 - push is best-effort
        print(f"[payouts] push failed: {err}")


# ── State transitions ───────────────────────────────────────────────────────
def create_transfer_for_reservation(res: dict, seller: dict) -> bool:
    """
    Transfer this reservation's host_payout from the platform balance to the
    seller's connected account. Idempotent: a row that already has a transfer
    id is skipped. Returns True if a transfer (or a no-op payout) was recorded.
    """
    if res.get("stripe_transfer_id"):
        return False

    acct = (seller or {}).get("stripe_account_id")
    charge = res.get("stripe_charge_id")
    amount = _to_cents(res.get("host_payout"))

    if not acct or not charge:
        print(f"[payouts] cannot transfer reservation {res['id']}: "
              f"missing {'account' if not acct else 'charge'}")
        return False

    # Nothing to move (e.g. legacy/zero payout) — mark settled without a transfer.
    if amount <= 0:
        supabase.table("reservations").update(
            {"payout_status": "paid_out"}
        ).eq("id", res["id"]).execute()
        return True

    transfer = stripe.Transfer.create(
        amount=amount,
        currency="usd",
        destination=acct,
        source_transaction=charge,  # ← lets the transfer succeed pre-settlement
        transfer_group=str(res["id"]),
        metadata={"reservation_id": str(res["id"])},
    )
    supabase.table("reservations").update(
        {"stripe_transfer_id": transfer.id, "payout_status": "paid_out"}
    ).eq("id", res["id"]).execute()
    print(f"[payouts] transferred {amount}c to {acct} for reservation {res['id']}")
    return True


def refund_reservation(res: dict) -> bool:
    """Refund the buyer (seller never onboarded in time) and mark the row."""
    pi = res.get("stripe_payment_intent")
    if not pi:
        return False
    try:
        stripe.Refund.create(payment_intent=pi)
    except Exception as err:  # noqa: BLE001
        print(f"[payouts] refund failed for reservation {res['id']}: {err}")
        return False
    supabase.table("reservations").update(
        {"payout_status": "refunded", "status": "cancelled"}
    ).eq("id", res["id"]).execute()
    print(f"[payouts] refunded reservation {res['id']} (seller never onboarded)")
    return True


def cancel_reservation(reservation_id: str, current_user_id: str):
    """
    Renter-initiated cancellation, gated on CANCELLATION_WINDOW_HOURS (env var,
    default 24) before start_time. Full refund, including the platform fee —
    same as the two existing automatic-refund cases, so there's one refund
    behavior in the whole app, not two.

    Only reachable while payout_status is still 'held': once the sweep has
    moved a reservation to 'payout_ready' the stay has already started (or
    ended), which is past any cancellation window by construction, and once
    a transfer or refund has happened this would be a second one.
    """
    res = (
        supabase.table("reservations")
        .select("id, renter_id, status, payout_status, start_time, stripe_payment_intent")
        .eq("id", reservation_id)
        .execute()
        .data
    )
    res = res[0] if res else None
    if not res:
        return jsonify({"error": "Reservation not found"}), 404
    if res.get("renter_id") != current_user_id:
        return jsonify({"error": "Forbidden"}), 403
    if res.get("payout_status") != "held":
        return jsonify({"error": "This booking can no longer be cancelled"}), 409

    window_hours = float(os.getenv("CANCELLATION_WINDOW_HOURS", CANCELLATION_WINDOW_HOURS_DEFAULT))
    start = _parse_ts(res["start_time"])
    now = datetime.now(timezone.utc)
    if start - now < timedelta(hours=window_hours):
        return jsonify({
            "error": f"Bookings can only be cancelled at least {window_hours:g} hours before they start",
        }), 409

    pi = res.get("stripe_payment_intent")
    if not pi:
        return jsonify({"error": "No payment on file for this reservation"}), 409

    # Claim the row BEFORE touching Stripe. A plain read-then-refund would let
    # a double-tap (or a re-mounted screen) pass the payout_status=='held'
    # check twice and fire two refunds. The conditional UPDATE below only
    # matches — and only returns a row — for whichever request gets there
    # first; Postgres re-checks the WHERE clause after the row's lock clears,
    # so a losing concurrent request sees zero rows updated and bails here
    # without ever calling Stripe.
    claimed = (
        supabase.table("reservations")
        .update({"payout_status": "refunding"})
        .eq("id", reservation_id)
        .eq("payout_status", "held")
        .execute()
        .data
    )
    if not claimed:
        return jsonify({"error": "This booking is already being cancelled"}), 409

    stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
    try:
        stripe.Refund.create(payment_intent=pi)
    except Exception as err:  # noqa: BLE001
        print(f"[payouts] cancel-refund failed for reservation {reservation_id}: {err}")
        # Release the claim so this is retryable instead of stuck.
        supabase.table("reservations").update({"payout_status": "held"}).eq("id", reservation_id).execute()
        return jsonify({"error": "Refund failed, please contact support"}), 502

    supabase.table("reservations").update(
        {"status": "cancelled", "payout_status": "refunded"}
    ).eq("id", reservation_id).execute()
    print(f"[payouts] reservation {reservation_id} cancelled by renter {current_user_id}, refunded")
    return jsonify({"reservation_id": reservation_id, "refunded": True}), 200


def release_pending_for_account(account_id: str) -> int:
    """
    Called when a seller finishes onboarding (account.updated -> payouts_enabled).
    Marks the profile enabled and transfers every one of their payout_ready
    reservations. Returns the number of transfers made.
    """
    # .single() raises when 0 rows match (e.g. account not tied to any profile).
    # Never let that throw — log and treat it as "nothing to release".
    try:
        profile = (
            supabase.table("profiles")
            .select("id, stripe_account_id, expo_push_token")
            .eq("stripe_account_id", account_id)
            .single()
            .execute()
            .data
        )
    except Exception as err:  # noqa: BLE001
        print(f"[payouts] release_pending_for_account: profile lookup failed for {account_id}: {err}")
        return 0
    if not profile:
        print(f"[payouts] no profile for stripe account {account_id}; nothing to release")
        return 0

    supabase.table("profiles").update({"payouts_enabled": True}).eq(
        "id", profile["id"]
    ).execute()

    listing_ids = [
        row["id"]
        for row in supabase.table("listings")
        .select("id")
        .eq("owner_id", profile["id"])
        .execute()
        .data
    ]
    if not listing_ids:
        return 0

    ready = (
        supabase.table("reservations")
        .select("*")
        .eq("payout_status", "payout_ready")
        .in_("listing_id", listing_ids)
        .execute()
        .data
    )
    seller = {"stripe_account_id": account_id}
    count = 0
    for res in ready:
        try:
            if create_transfer_for_reservation(res, seller):
                count += 1
        except Exception as err:  # noqa: BLE001
            print(f"[payouts] transfer error for {res['id']}: {err}")
    return count


def _notify_seller_payout_ready(seller: dict, res: dict):
    if not seller:
        return
    amount = res.get("host_payout") or 0
    send_push(
        seller.get("expo_push_token"),
        "Your spot's session ended 🎉",
        f"You earned ${float(amount):.2f}. Set up payouts to get paid.",
        {"type": "payout_ready", "reservation_id": str(res["id"])},
    )


# ── The periodic sweep (invoked by pg_cron or the fallback scheduler) ────────
def run_payout_sweep() -> dict:
    """
    Idempotent housekeeping pass. Safe to run every ~15 minutes.
      1. held rows whose session ended  -> payout_ready (+ transfer or notify)
      2. payout_ready older than 30 days -> refund the buyer
      3. abandoned pending_payment rows  -> cancel to free the slot
    """
    stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
    now = datetime.now(timezone.utc)
    summary = {"transferred": 0, "notified": 0, "refunded": 0, "expired": 0}

    # 1) Session ended → ready for payout.
    ended = (
        supabase.table("reservations")
        .select("*")
        .eq("payout_status", "held")
        .lte("end_time", _iso(now))
        .execute()
        .data
    )
    for res in ended:
        seller = _seller_profile_for_reservation(res)
        supabase.table("reservations").update(
            {"payout_status": "payout_ready", "payout_ready_at": _iso(now)}
        ).eq("id", res["id"]).execute()
        res["payout_status"] = "payout_ready"

        onboarded = bool(seller and seller.get("payouts_enabled") and seller.get("stripe_account_id"))
        if onboarded:
            try:
                if create_transfer_for_reservation(res, seller):
                    summary["transferred"] += 1
            except Exception as err:  # noqa: BLE001
                print(f"[payouts] sweep transfer error for {res['id']}: {err}")
        else:
            _notify_seller_payout_ready(seller, res)
            summary["notified"] += 1

    # 2) Unclaimed too long → refund the buyer.
    cutoff = _iso(now - timedelta(days=HOLD_WINDOW_DAYS))
    stale = (
        supabase.table("reservations")
        .select("*")
        .eq("payout_status", "payout_ready")
        .lte("payout_ready_at", cutoff)
        .execute()
        .data
    )
    for res in stale:
        if refund_reservation(res):
            summary["refunded"] += 1

    # 3) Abandoned checkout → cancel so the slot is bookable again.
    exp_cutoff = _iso(now - timedelta(minutes=PENDING_EXPIRY_MINUTES))
    abandoned = (
        supabase.table("reservations")
        .select("*")
        .eq("payout_status", "pending_payment")
        .lte("created_at", exp_cutoff)
        .execute()
        .data
    )
    for res in abandoned:
        pi_id = res.get("stripe_payment_intent")
        if not pi_id:
            continue
        try:
            pi = stripe.PaymentIntent.retrieve(pi_id)
            if pi.status in ("succeeded", "processing"):
                continue  # webhook will promote it to 'held'
            try:
                stripe.PaymentIntent.cancel(pi_id)
            except Exception:  # noqa: BLE001 - already canceled/uncancelable
                pass
        except Exception as err:  # noqa: BLE001
            print(f"[payouts] abandon check failed for {res['id']}: {err}")
            continue
        supabase.table("reservations").update(
            {"payout_status": "cancelled", "status": "cancelled"}
        ).eq("id", res["id"]).execute()
        summary["expired"] += 1

    # 4) Expired checkout holds → delete so the slot is bookable again.
    try:
        supabase.table("reservation_holds").delete().lte("expires_at", _iso(now)).execute()
    except Exception as err:  # noqa: BLE001
        print(f"[payouts] hold cleanup failed: {err}")

    return summary

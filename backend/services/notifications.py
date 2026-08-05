"""
Reservation lifecycle and payout reminder push notifications.

This module owns notification idempotency. The actual Expo send path remains
services.payouts.send_push so SpotOn keeps one push implementation.
"""

from datetime import datetime, timezone, timedelta

from services.supabase_client import supabase
from services.payouts import HOLD_WINDOW_DAYS, _iso, _parse_ts, send_push


PAYOUT_REMINDERS = (
    ("payout_reminder_1d", timedelta(days=1), "Payout reminder"),
    ("payout_reminder_3d", timedelta(days=3), "Payout reminder"),
    ("payout_reminder_1w", timedelta(days=7), "Payout reminder"),
    ("payout_reminder_2w", timedelta(days=14), "Final payout reminder"),
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _profile(user_id: str | None) -> dict | None:
    if not user_id:
        return None
    try:
        return (
            supabase.table("profiles")
            .select("id, expo_push_token")
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
    except Exception as err:  # noqa: BLE001
        print(f"[notifications] profile lookup failed for {user_id}: {err}")
        return None


def _reservation(reservation_id: str) -> dict | None:
    try:
        return (
            supabase.table("reservations")
            .select(
                "id, listing_id, renter_id, start_time, end_time, total_price, "
                "host_payout, payout_status, payout_ready_at, listings(owner_id, address)"
            )
            .eq("id", reservation_id)
            .single()
            .execute()
            .data
        )
    except Exception as err:  # noqa: BLE001
        print(f"[notifications] reservation lookup failed for {reservation_id}: {err}")
        return None


def _listing(res: dict) -> dict:
    return (res.get("listings") or {}) if res else {}


def _address(res: dict) -> str:
    return _listing(res).get("address") or "your SpotOn parking spot"


def _format_when(value) -> str:
    return _parse_ts(value).astimezone().strftime("%b %-d at %-I:%M %p")


def _insert_event(
    reservation_id: str,
    event_key: str,
    recipient_id: str,
    title: str,
    body: str,
    data: dict,
    status: str,
) -> bool:
    try:
        supabase.table("notification_events").insert({
            "reservation_id": reservation_id,
            "event_key": event_key,
            "recipient_id": recipient_id,
            "status": status,
            "title": title,
            "body": body,
            "data": data,
        }).execute()
        return True
    except Exception as err:  # noqa: BLE001
        msg = str(err).lower()
        if "duplicate" in msg or "23505" in msg or "unique" in msg:
            return False
        print(f"[notifications] event insert failed for {reservation_id}/{event_key}: {err}")
        return False


def _send_once(res: dict, event_key: str, recipient_id: str | None, title: str, body: str, data: dict) -> bool:
    profile = _profile(recipient_id)
    if not profile:
        return False

    payload = {"reservation_id": str(res["id"]), **data}
    token = profile.get("expo_push_token")
    status = "sent" if token else "skipped_no_token"
    if not _insert_event(str(res["id"]), event_key, str(profile["id"]), title, body, payload, status):
        return False

    send_push(token, title, body, payload)
    return True


def send_booking_notifications(reservation_id: str) -> dict:
    """Called after finalize_paid_reservation succeeds; safe with webhook/client duplicates."""
    res = _reservation(reservation_id)
    if not res:
        return {"booked_renter": False, "booked_lister": False}

    owner_id = _listing(res).get("owner_id")
    address = _address(res)
    start = _format_when(res["start_time"])
    total = float(res.get("total_price") or 0)

    return {
        "booked_renter": _send_once(
            res,
            "booked_renter",
            res.get("renter_id"),
            "Reservation booked",
            f"You're booked for {address} on {start}. Total paid: ${total:.2f}.",
            {"type": "reservation_booked", "role": "renter"},
        ),
        "booked_lister": _send_once(
            res,
            "booked_lister",
            owner_id,
            "Your spot was booked",
            f"Payment was made for {address}. Reservation starts {start}.",
            {"type": "reservation_booked", "role": "lister"},
        ),
    }


def _send_start_notifications(res: dict) -> int:
    owner_id = _listing(res).get("owner_id")
    address = _address(res)
    sent = 0
    if _send_once(
        res,
        "started_renter",
        res.get("renter_id"),
        "Reservation starting",
        f"Your reservation at {address} starts now.",
        {"type": "reservation_started", "role": "renter"},
    ):
        sent += 1
    if _send_once(
        res,
        "started_lister",
        owner_id,
        "Reservation starting",
        f"Your spot at {address} is reserved starting now.",
        {"type": "reservation_started", "role": "lister"},
    ):
        sent += 1
    return sent


def _send_end_notifications(res: dict) -> int:
    owner_id = _listing(res).get("owner_id")
    address = _address(res)
    sent = 0
    if _send_once(
        res,
        "ended_renter",
        res.get("renter_id"),
        "Reservation ended",
        f"Your reservation at {address} has ended.",
        {"type": "reservation_ended", "role": "renter"},
    ):
        sent += 1
    if _send_once(
        res,
        "ended_lister",
        owner_id,
        "Reservation ended",
        f"The reservation at {address} has ended.",
        {"type": "reservation_ended", "role": "lister"},
    ):
        sent += 1
    return sent


def _send_payout_reminder(res: dict, event_key: str, title: str) -> bool:
    owner_id = _listing(res).get("owner_id")
    amount = float(res.get("host_payout") or 0)
    if event_key == "payout_reminder_2w":
        body = (
            f"You still have ${amount:.2f} waiting. Set up payouts soon; "
            "after about 1 month from when this spot was reserved, the money "
            "will be returned to the reserver."
        )
    else:
        body = f"You still have ${amount:.2f} waiting from a completed reservation. Set up payouts to collect it."
    return _send_once(
        res,
        event_key,
        owner_id,
        title,
        body,
        {"type": "payout_reminder", "milestone": event_key},
    )


def run_notification_sweep() -> dict:
    """Poll due time-based notifications. Safe to run on the same cadence as payout sweep."""
    now = _now()
    summary = {"started": 0, "ended": 0, "payout_reminders": 0}
    lookback = now - timedelta(days=HOLD_WINDOW_DAYS + 1)

    # Reservation starts. Booked notifications are sent immediately at finalize,
    # so this covers only scheduled reservations whose start was meaningfully in
    # the future at reservation creation time.
    started = (
        supabase.table("reservations")
        .select("id, listing_id, renter_id, start_time, end_time, created_at, listings(owner_id, address)")
        .eq("status", "confirmed")
        .lte("start_time", _iso(now))
        .gte("start_time", _iso(lookback))
        .execute()
        .data
    )
    for res in started:
        created_at = _parse_ts(res.get("created_at") or res["start_time"])
        if _parse_ts(res["start_time"]) <= created_at + timedelta(minutes=1):
            continue
        summary["started"] += _send_start_notifications(res)

    ended = (
        supabase.table("reservations")
        .select("id, listing_id, renter_id, start_time, end_time, listings(owner_id, address)")
        .eq("status", "confirmed")
        .lte("end_time", _iso(now))
        .gte("end_time", _iso(lookback))
        .execute()
        .data
    )
    for res in ended:
        summary["ended"] += _send_end_notifications(res)

    active_payout_statuses = ["held", "payout_ready"]
    cutoff = now - timedelta(days=14)
    payout_rows = (
        supabase.table("reservations")
        .select(
            "id, listing_id, renter_id, start_time, end_time, host_payout, payout_status, "
            "payout_ready_at, listings(owner_id, address)"
        )
        .in_("payout_status", active_payout_statuses)
        .lte("end_time", _iso(now - timedelta(days=1)))
        .gte("end_time", _iso(cutoff - timedelta(days=1)))
        .execute()
        .data
    )
    for res in payout_rows:
        ended_at = _parse_ts(res["end_time"])
        # Match the existing 30-day refund window by measuring reminder age from
        # payout_ready_at when available; otherwise fall back to reservation end.
        base = _parse_ts(res.get("payout_ready_at") or res["end_time"])
        if now >= ended_at + timedelta(days=HOLD_WINDOW_DAYS):
            continue
        for event_key, offset, title in PAYOUT_REMINDERS:
            if now >= base + offset and _send_payout_reminder(res, event_key, title):
                summary["payout_reminders"] += 1

    return summary

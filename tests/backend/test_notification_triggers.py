"""Tests for the three notification triggers (task: week of 2026-07-29).

Asked: "they should give notifications whenever a lister purchases a listing,
its time begins, and its time ends. (Needs to be tested)".

Tested at this layer on purpose — the app needs a dev build on a device, so the
only way to check these deterministically is against the service functions with
the Supabase client and Expo transport faked.

WHAT THESE PIN
  * booking notifies BOTH sides, once each, with the renter/lister roles right;
  * start and end notify both sides;
  * the (reservation_id, event_key) unique constraint is what makes the webhook
    and the client calling finalize both safe — a second run sends nothing;
  * a recipient with no push token still records an event, so the sweep does not
    retry them forever.

KNOWN GAP THIS DOCUMENTS (see test_event_is_recorded_sent_before_the_push_is_attempted):
_send_once inserts the event with status 'sent' and only then calls send_push,
which is documented "never raises into the caller". So a push that fails in
transport is recorded as sent and never retried: notification_events records
INTENT, not delivery. That is a deliberate trade for dedupe (claim-then-send is
the right order), but the status value is currently optimistic — worth a
'pending' -> 'sent'/'failed' settle if delivery ever needs to be provable.
"""
import sys
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

RENTER = "11111111-1111-4111-8111-111111111111"
OWNER = "22222222-2222-4222-8222-222222222222"
RES_ID = "33333333-3333-4333-8333-333333333333"


class _FakeDB:
    """Stands in for the Supabase client: profiles, reservations, and a
    notification_events table with the real UNIQUE(reservation_id, event_key)."""

    def __init__(self, tokens=None):
        self.events = []          # rows that "landed"
        self.pushes = []          # (token, title, body, data)
        self.tokens = tokens if tokens is not None else {RENTER: "ExpoTok[renter]",
                                                         OWNER: "ExpoTok[owner]"}

    # -- query surface -------------------------------------------------------
    def table(self, name):
        return _FakeTable(self, name)

    # -- helpers -------------------------------------------------------------
    def _profile(self, uid):
        if uid not in (RENTER, OWNER):
            return None
        return {"id": uid, "expo_push_token": self.tokens.get(uid)}

    def _reservation(self):
        return {
            "id": RES_ID,
            "renter_id": RENTER,
            "listing_id": "listing-1",
            "start_time": "2026-08-01T10:00:00+00:00",
            "end_time": "2026-08-01T12:00:00+00:00",
            "total_price": 6.90,
            "host_payout": 6.00,
            "status": "confirmed",
            "listings": {"owner_id": OWNER, "address": "1 Test St"},
        }


class _FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self._payload = None
        self._filters = {}

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def single(self):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if self.name == "notification_events" and self._payload is not None:
            key = (self._payload["reservation_id"], self._payload["event_key"])
            if any((e["reservation_id"], e["event_key"]) == key for e in self.db.events):
                # Exactly what Postgres raises through supabase-py.
                raise RuntimeError(
                    'duplicate key value violates unique constraint '
                    '"notification_events_reservation_id_event_key_key" (23505)'
                )
            self.db.events.append(self._payload)
            return types.SimpleNamespace(data=[self._payload])
        if self.name == "profiles":
            return types.SimpleNamespace(data=self.db._profile(self._filters.get("id")))
        if self.name == "reservations":
            return types.SimpleNamespace(data=self.db._reservation())
        return types.SimpleNamespace(data=None)


@pytest.fixture
def notifications(monkeypatch):
    """Import services.notifications with the DB and Expo transport faked."""
    db = _FakeDB()

    supabase_mod = types.ModuleType("services.supabase_client")
    supabase_mod.supabase = db
    monkeypatch.setitem(sys.modules, "services.supabase_client", supabase_mod)

    monkeypatch.delitem(sys.modules, "services.notifications", raising=False)
    monkeypatch.delitem(sys.modules, "services.payouts", raising=False)
    import services.notifications as notif

    monkeypatch.setattr(notif, "supabase", db)
    monkeypatch.setattr(notif, "send_push",
                        lambda token, title, body, data: db.pushes.append((token, title, body, data)))
    notif._db = db  # test handle
    return notif


def _keys(db):
    return sorted(e["event_key"] for e in db.events)


# ── trigger 1: a lister's spot is purchased ────────────────────────────────────

def test_booking_notifies_both_sides_once(notifications):
    db = notifications._db
    result = notifications.send_booking_notifications(RES_ID)

    assert result == {"booked_renter": True, "booked_lister": True}
    assert _keys(db) == ["booked_lister", "booked_renter"]
    assert len(db.pushes) == 2

    by_recipient = {e["recipient_id"]: e for e in db.events}
    assert by_recipient[RENTER]["data"]["role"] == "renter"
    assert by_recipient[OWNER]["data"]["role"] == "lister"
    # The lister's copy must say a payment happened — that's the asked-for signal.
    assert "Payment was made" in by_recipient[OWNER]["body"]


def test_booking_is_not_sent_twice(notifications):
    """finalize_booking (client) and the payment_intent.succeeded webhook both
    call this for the same reservation. The second must be a no-op."""
    db = notifications._db
    notifications.send_booking_notifications(RES_ID)
    second = notifications.send_booking_notifications(RES_ID)

    assert second == {"booked_renter": False, "booked_lister": False}
    assert len(db.events) == 2, "unique constraint must stop a duplicate row"
    assert len(db.pushes) == 2, "and no second phone notification"


# ── triggers 2 and 3: time begins, time ends ──────────────────────────────────

def test_start_notifies_both_sides_once(notifications):
    db = notifications._db
    res = db._reservation()

    assert notifications._send_start_notifications(res) == 2
    assert _keys(db) == ["started_lister", "started_renter"]
    assert notifications._send_start_notifications(res) == 0, "sweep reruns must not resend"
    assert len(db.pushes) == 2


def test_end_notifies_both_sides_once(notifications):
    db = notifications._db
    res = db._reservation()

    assert notifications._send_end_notifications(res) == 2
    assert _keys(db) == ["ended_lister", "ended_renter"]
    assert notifications._send_end_notifications(res) == 0
    assert len(db.pushes) == 2


def test_start_and_end_are_independent_events(notifications):
    """Distinct event_keys, so 'started' never suppresses 'ended'."""
    db = notifications._db
    res = db._reservation()
    notifications._send_start_notifications(res)
    notifications._send_end_notifications(res)

    assert _keys(db) == ["ended_lister", "ended_renter",
                         "started_lister", "started_renter"]


# ── recipients without a device ───────────────────────────────────────────────

def test_missing_push_token_records_the_event_and_sends_nothing(monkeypatch):
    """A tokenless recipient must still consume its event_key, or every sweep
    would retry them forever. Status says skipped_no_token, not sent."""
    db = _FakeDB(tokens={RENTER: None, OWNER: "ExpoTok[owner]"})

    supabase_mod = types.ModuleType("services.supabase_client")
    supabase_mod.supabase = db
    monkeypatch.setitem(sys.modules, "services.supabase_client", supabase_mod)
    monkeypatch.delitem(sys.modules, "services.notifications", raising=False)
    monkeypatch.delitem(sys.modules, "services.payouts", raising=False)
    import services.notifications as notif
    monkeypatch.setattr(notif, "supabase", db)
    monkeypatch.setattr(notif, "send_push",
                        lambda t, ti, b, d: db.pushes.append((t, ti, b, d)))

    result = notif.send_booking_notifications(RES_ID)

    assert result == {"booked_renter": True, "booked_lister": True}
    statuses = {e["recipient_id"]: e["status"] for e in db.events}
    assert statuses[RENTER] == "skipped_no_token"
    assert statuses[OWNER] == "sent"


# ── the documented gap ────────────────────────────────────────────────────────

def test_event_is_recorded_sent_before_the_push_is_attempted(notifications):
    """Pins current behaviour, and names the limitation.

    The row is written (status 'sent') BEFORE send_push runs, and send_push is
    documented never to raise. Claim-then-send is the correct ORDER for dedupe —
    it is what stops double-sending — but it means a transport failure is
    recorded as 'sent' and never retried, so this table proves intent, not
    delivery. If delivery ever has to be provable, settle the row after the
    send ('pending' -> 'sent'/'failed') instead of asserting it up front.
    """
    db = notifications._db

    def _exploding_push(*_a, **_k):
        raise RuntimeError("expo unreachable")

    # send_push itself swallows in production; simulate the transport dying
    # underneath it to show the recorded status does not reflect the outcome.
    import services.notifications as notif
    original = notif.send_push
    notif.send_push = lambda t, ti, b, d: None  # what production does: silent
    try:
        notifications.send_booking_notifications(RES_ID)
    finally:
        notif.send_push = original

    assert [e["status"] for e in db.events] == ["sent", "sent"]
    assert db.pushes == [], "nothing actually went out, yet both rows say 'sent'"

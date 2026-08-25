"""Regression tests for the "payment succeeded, booking not confirmed" class.

A renter was charged $331.20 for a booking the DB then refused, and the code's
own comment admitted the recovery was "intentionally deferred: log loudly ...
needs manual review". These pin the two halves of the fix:

  1. terminal failures are classified as terminal, retryable ones are not, and
  2. a terminal failure refunds automatically, exactly once.

No Stripe network calls and no device: the refund path's Stripe surface is
faked and the Supabase client (which needs live env vars) is stubbed. Run with
backend/.venv, which the README already prescribes:
    backend/.venv/bin/python -m pytest tests/
The app itself needs a dev build on a phone, which is exactly why these tests
live at this layer instead.
"""
import sys
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))


@pytest.fixture
def stripe_client(monkeypatch):
    """Import services.stripe_client with its heavy deps stubbed out.

    supabase_client builds a live client at import time and stripe/dotenv may be
    absent; none of that is what these tests are about.
    """
    for name, attrs in {
        "services.supabase_client": {"supabase": types.SimpleNamespace()},
        "services.payouts": {"_parse_ts": lambda *_a: None,
                             "release_pending_for_account": lambda *_a: 0},
        "services.notifications": {"send_booking_notifications": lambda *_a: {}},
    }.items():
        module = types.ModuleType(name)
        for attr, value in attrs.items():
            setattr(module, attr, value)
        monkeypatch.setitem(sys.modules, name, module)

    monkeypatch.delitem(sys.modules, "services.stripe_client", raising=False)
    import services.stripe_client as sc
    return sc


# ── classification: terminal vs retryable ──────────────────────────────────────

@pytest.mark.parametrize("message", [
    "db_P0001: Daily bookings not supported for this listing",  # the real one
    "db_P0001: No rates available for this listing",
    "db_23505: duplicate key value violates unique constraint",
    "db_23P01: conflicting key value violates exclusion constraint",
    "slot_unavailable",
    "missing_metadata: vehicle_id",
])
def test_terminal_errors_are_classified_terminal(stripe_client, message):
    """These can never succeed on retry, so the capture must be given back."""
    assert stripe_client._is_terminal_finalize_error(message) is True


@pytest.mark.parametrize("message", [
    "db_error: connection reset by peer",
    "db_08006: could not connect to server",
    "rpc_empty_response",
    "rpc_no_reservation_id",
    "finalize_crashed: KeyError('metadata')",
    "",
    None,
])
def test_retryable_errors_are_not_refunded(stripe_client, message):
    """Refunding a transient failure would cancel a booking that is about to
    work — the webhook retry is the recovery path for these."""
    assert stripe_client._is_terminal_finalize_error(message) is False


# ── the refund itself ──────────────────────────────────────────────────────────

class _FakeRefund:
    """Minimal stand-in for stripe.Refund, recording what it was asked to do."""

    def __init__(self, existing=None, explode=False):
        self.existing = existing or []
        self.explode = explode
        self.created = []

    def list(self, payment_intent=None, limit=None):
        return types.SimpleNamespace(data=list(self.existing))

    def create(self, **kwargs):
        if self.explode:
            raise RuntimeError("stripe is down")
        self.created.append(kwargs)
        return types.SimpleNamespace(id="re_test")


def test_terminal_failure_refunds_the_payment(stripe_client, monkeypatch):
    fake = _FakeRefund()
    monkeypatch.setattr(stripe_client.stripe, "Refund", fake)

    result = stripe_client._refund_stranded_payment(
        "pi_331", "db_P0001: Daily bookings not supported for this listing"
    )

    assert result == "refunded"
    assert len(fake.created) == 1
    call = fake.created[0]
    assert call["payment_intent"] == "pi_331"
    # The cause must survive into Stripe for reconciliation, not just the log.
    assert "Daily bookings not supported" in call["metadata"]["spoton_refund_cause"]
    # Idempotency key keyed on the PI is what stops the client path and the
    # webhook path from both refunding the same capture.
    assert call["idempotency_key"] == "spoton-stranded-pi_331"


def test_refund_is_not_issued_twice(stripe_client, monkeypatch):
    """The client call and the webhook both run this path for the same payment."""
    fake = _FakeRefund(existing=[types.SimpleNamespace(id="re_already")])
    monkeypatch.setattr(stripe_client.stripe, "Refund", fake)

    result = stripe_client._refund_stranded_payment("pi_331", "slot_unavailable")

    assert result == "already_refunded"
    assert fake.created == [], "must not create a second refund"


def test_refund_failure_is_reported_not_raised(stripe_client, monkeypatch):
    """A failed refund must not turn into a 500 that hides the original problem —
    the caller still has to tell the renter something true."""
    fake = _FakeRefund(explode=True)
    monkeypatch.setattr(stripe_client.stripe, "Refund", fake)

    result = stripe_client._refund_stranded_payment("pi_331", "slot_unavailable")

    assert result == "refund_failed"


def test_missing_payment_intent_is_handled(stripe_client, monkeypatch):
    fake = _FakeRefund()
    monkeypatch.setattr(stripe_client.stripe, "Refund", fake)
    assert stripe_client._refund_stranded_payment(None, "slot_unavailable") == "no_payment_intent"
    assert fake.created == []


# ── the pre-charge gate ────────────────────────────────────────────────────────

def test_pre_charge_check_returns_the_db_reason(stripe_client, monkeypatch):
    """create_booking_payment consults the SAME rule the trigger enforces, so a
    rejected booking never reaches Stripe at all."""
    class _RPC:
        def execute(self):
            return types.SimpleNamespace(data="No rates available for this listing")

    monkeypatch.setattr(stripe_client.supabase, "rpc",
                        lambda name, params: _RPC(), raising=False)

    reason = stripe_client._reservation_validation_error(
        "listing-1", "2026-08-01T10:00:00+00:00", "2026-08-01T12:00:00+00:00"
    )
    assert reason == "No rates available for this listing"


def test_pre_charge_check_allows_when_db_returns_null(stripe_client, monkeypatch):
    class _RPC:
        def execute(self):
            return types.SimpleNamespace(data=None)

    monkeypatch.setattr(stripe_client.supabase, "rpc",
                        lambda name, params: _RPC(), raising=False)

    assert stripe_client._reservation_validation_error(
        "listing-1", "2026-08-01T10:00:00+00:00", "2026-08-01T12:00:00+00:00"
    ) is None


def test_pre_charge_check_fails_open_when_unreachable(stripe_client, monkeypatch):
    """If the speculative check itself cannot run, fall through to the trigger
    rather than refusing every booking — the trigger is still the backstop."""
    def _boom(name, params):
        raise RuntimeError("supabase unreachable")

    monkeypatch.setattr(stripe_client.supabase, "rpc", _boom, raising=False)

    assert stripe_client._reservation_validation_error(
        "listing-1", "2026-08-01T10:00:00+00:00", "2026-08-01T12:00:00+00:00"
    ) is None


# ── the gate is WIRED, not merely present ──────────────────────────────────────
# The bug was never a missing rule; it was a rule that ran after the money moved.
# A test that only exercises the helper would pass even if create_booking_payment
# never called it, so this pins the call site itself.

class _FluentTable:
    """supabase.table(...).select(...).eq(...).single().execute() -> .data"""

    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def single(self):
        return self

    def execute(self):
        return types.SimpleNamespace(data=self._data)


def test_create_booking_payment_refuses_before_touching_stripe(stripe_client, monkeypatch):
    from flask import Flask

    listing = {
        "owner_id": "owner-1", "hourly_rate": None, "daily_rate": None,
        "weekly_rate": None, "monthly_rate": None, "price_per_hour": None,
    }
    monkeypatch.setattr(stripe_client.supabase, "table",
                        lambda _name: _FluentTable(listing), raising=False)

    # The DB says no.
    monkeypatch.setattr(stripe_client, "_reservation_validation_error",
                        lambda *_a: "No rates available for this listing")

    # Anything that would move money or take a slot must never be reached.
    def _forbidden(*_a, **_k):
        raise AssertionError("must not be called before validation passes")

    created = []
    monkeypatch.setattr(stripe_client.stripe, "PaymentIntent",
                        types.SimpleNamespace(create=_forbidden))
    monkeypatch.setattr(stripe_client.stripe, "Customer",
                        types.SimpleNamespace(create=_forbidden))
    monkeypatch.setattr(stripe_client.supabase, "rpc", _forbidden, raising=False)

    app = Flask(__name__)
    with app.app_context():
        response, status = stripe_client.create_booking_payment(
            "listing-1", "renter-1", "vehicle-1",
            "2026-08-01T10:00:00+00:00", "2026-08-01T12:00:00+00:00",
        )

    assert status == 400
    body = response.get_json()
    assert body["code"] == "invalid_booking"
    assert body["error"] == "No rates available for this listing"
    assert created == []


def _finalize_with(stripe_client, monkeypatch, outcome_error, refund_result="refunded"):
    """Drive finalize_booking against a succeeded PI whose reservation fails."""
    from flask import Flask

    monkeypatch.setattr(
        stripe_client.stripe, "PaymentIntent",
        types.SimpleNamespace(retrieve=lambda *_a, **_k: {"id": "pi_331", "status": "succeeded"}),
    )
    monkeypatch.setattr(stripe_client, "_finalize_reservation_from_pi",
                        lambda _pi: {"error": outcome_error})
    refunds = []

    def _fake_refund(pi_id, reason):
        refunds.append((pi_id, reason))
        return refund_result

    monkeypatch.setattr(stripe_client, "_refund_stranded_payment", _fake_refund)

    app = Flask(__name__)
    with app.app_context():
        response, status = stripe_client.finalize_booking("pi_331")
        return response.get_json(), status, refunds


def test_finalize_refunds_and_says_so_on_terminal_failure(stripe_client, monkeypatch):
    """The wiring, not just the helper: a terminal failure must actually trigger
    the refund and tell the renter they were not charged — the old behaviour was
    a 409 plus 'contact support'."""
    body, status, refunds = _finalize_with(
        stripe_client, monkeypatch,
        "db_P0001: Daily bookings not supported for this listing",
    )

    assert status == 409
    assert refunds == [("pi_331", "db_P0001: Daily bookings not supported for this listing")]
    assert body["refunded"] is True
    assert "not been charged" in body["message"]


def test_finalize_does_not_refund_a_retryable_failure(stripe_client, monkeypatch):
    """A dropped connection may succeed on the webhook's retry; refunding it
    would cancel a booking that is about to work."""
    body, status, refunds = _finalize_with(
        stripe_client, monkeypatch, "db_error: connection reset by peer",
    )

    assert status == 409
    assert refunds == [], "must not refund a retryable failure"
    assert body["refunded"] is False
    assert body["refund_status"] == "retryable"


def test_finalize_is_honest_when_the_refund_itself_fails(stripe_client, monkeypatch):
    """If the make-good fails, the renter must be told to contact support — that
    message is correct HERE and was wrong before, when it was shown even though
    no refund had been attempted at all."""
    body, status, _ = _finalize_with(
        stripe_client, monkeypatch, "slot_unavailable", refund_result="refund_failed",
    )

    assert status == 409
    assert body["refunded"] is False
    assert "contact support" in body["message"].lower()


# ── no SQLSTATE may ever reach a renter's screen ───────────────────────────────
# A customer read "db_P0001: Daily bookings not supported for this listing" in a
# dialog, because finalize's catch-all formats DB failures as
# 'db_<SQLSTATE>: <SQLERRM>' and the UI displayed that string directly.

@pytest.mark.parametrize("error", [
    "db_P0001: No rates available for this listing",
    "db_P0001: Listing not found",
    "db_23505: duplicate key value violates unique constraint \"reservations_pkey\"",
    "db_23P01: conflicting key value violates exclusion constraint \"no_overlap\"",
    "slot_unavailable",
    "missing_metadata: vehicle_id",
    "db_error: connection reset by peer",
    "rpc_empty_response",
])
def test_no_response_message_leaks_a_sqlstate_or_internals(stripe_client, monkeypatch, error):
    body, status, _ = _finalize_with(stripe_client, monkeypatch, error)

    assert status == 409
    message = body["message"]
    assert "db_" not in message, f"raw error string leaked into the message: {message}"
    assert "SQLSTATE" not in message
    assert "constraint" not in message.lower(), "Postgres internals must not be shown"
    assert message[0].isupper() and message.rstrip().endswith((".", "!")), \
        f"not a presentable sentence: {message!r}"
    # The raw string is still available for logs and support, just not for display.
    assert body["detail"] == error


def test_our_own_raise_text_is_surfaced_because_it_is_human(stripe_client, monkeypatch):
    """P0001 means 'a trigger of ours raised', and that text is written by us for
    people — so it is worth showing, unlike constraint internals."""
    body, _, _ = _finalize_with(
        stripe_client, monkeypatch, "db_P0001: No rates available for this listing")

    assert body["message"].startswith("No rates available for this listing.")


def test_conflict_becomes_plain_english_not_constraint_names(stripe_client, monkeypatch):
    body, _, _ = _finalize_with(
        stripe_client, monkeypatch,
        'db_23P01: conflicting key value violates exclusion constraint "no_overlap"')

    assert body["message"].startswith("That spot was just booked by someone else.")


def test_retryable_message_does_not_alarm_or_invite_a_second_payment(stripe_client, monkeypatch):
    """The payment stands and the webhook will finish the booking, so the renter
    must not be told they were refunded, nor nudged into paying twice."""
    body, _, refunds = _finalize_with(
        stripe_client, monkeypatch, "db_error: connection reset by peer")

    assert refunds == []
    message = body["message"].lower()
    assert "refund" not in message
    assert "don't pay again" in message or "do not pay again" in message

"""Deadlocks during finalize must be retried, not silently stranded.

Two renters racing OVERLAPPING (not identical) ranges on one listing both reach
a succeeded payment and both call finalize. Measured against the real function
in Postgres over 30 concurrent trials, the loser came back 'slot_unavailable'
half the time and 'db_40P01: deadlock detected' the other half. Only the first
was terminal, so half of all losing renters were charged, given no reservation,
and never refunded.

40P01 is genuinely retryable — the transaction was rolled back and the same call
usually succeeds moments later — but nothing ever retried it. The webhook ACKs
200 regardless and there is no reconciliation sweep, so "retryable" meant
"stranded". These pin both halves of the fix: the retry, and the classification
that catches whatever survives it.

This class is invisible to a fake database, which is why it went unnoticed: the
fake never contends. Here the contention is simulated at the RPC boundary; the
real-Postgres measurement lives in the PR.
"""
import sys
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))


@pytest.fixture
def stripe_client(monkeypatch):
    """Import services.stripe_client with its heavy deps stubbed out."""
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
    # Never actually sleep between attempts — the delay is real-world jitter,
    # not behaviour under test, and three of them would slow the suite.
    # Guarded so that reverting the fix makes these tests FAIL on their
    # assertions rather than ERROR in setup: an error can't tell you whether the
    # behaviour regressed or the module merely changed shape.
    if hasattr(sc, "time"):
        monkeypatch.setattr(sc.time, "sleep", lambda _s: None)
    return sc


PI = {
    "id": "pi_test_123",
    "latest_charge": "ch_test_123",
    "metadata": {
        "listing_id": "11111111-1111-1111-1111-111111111111",
        "renter_id": "22222222-2222-2222-2222-222222222222",
        "vehicle_id": "33333333-3333-3333-3333-333333333333",
        "start_time": "2026-08-10T09:00:00Z",
        "end_time": "2026-08-10T10:00:00Z",
        "total_price": "11.50",
        "platform_fee": "1.50",
        "host_payout": "10.00",
    },
}

DEADLOCK = "db_40P01: deadlock detected"


class _ScriptedRpc:
    """Returns a queued row per call, recording how many times it was invoked."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.calls = 0

    def __call__(self, _name, _params):
        self.calls += 1
        row = self.rows[min(self.calls - 1, len(self.rows) - 1)]
        return types.SimpleNamespace(execute=lambda: types.SimpleNamespace(data=[row]))


def _ok(rid="44444444-4444-4444-4444-444444444444"):
    return {"reservation_id": rid, "error_message": None}


def _err(message):
    return {"reservation_id": None, "error_message": message}


# ── classification ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("message", [
    "db_40P01: deadlock detected",          # the measured one
    "db_40001: could not serialize access",
])
def test_class_40_is_terminal_once_retries_are_exhausted(stripe_client, message):
    """Nothing re-drives a non-terminal failure, so leaving these 'retryable'
    means the renter is charged and never refunded."""
    assert stripe_client._is_terminal_finalize_error(message) is True


def test_connection_errors_stay_retryable(stripe_client):
    """Unlike a deadlock, a dropped connection may have committed the insert —
    refunding could cancel a booking that exists."""
    assert stripe_client._is_terminal_finalize_error("db_08006: could not connect") is False


# ── the retry ─────────────────────────────────────────────────────────────────

def test_deadlock_is_retried_and_succeeds(stripe_client, monkeypatch):
    """The common case: the racer that lost retries and gets its reservation."""
    rpc = _ScriptedRpc([_err(DEADLOCK), _ok()])
    monkeypatch.setattr(stripe_client.supabase, "rpc", rpc, raising=False)

    outcome = stripe_client._finalize_reservation_from_pi(PI)

    assert rpc.calls == 2
    assert outcome == {"reservation_id": "44444444-4444-4444-4444-444444444444"}


def test_retry_finds_the_row_the_other_racer_created(stripe_client, monkeypatch):
    """Client and webhook deadlocking over the SAME payment: finalize checks
    stripe_payment_intent before inserting, so the retry returns the existing
    reservation instead of showing 'charged, contact support' for a booking
    that already exists."""
    rpc = _ScriptedRpc([_err(DEADLOCK), _ok("55555555-5555-5555-5555-555555555555")])
    monkeypatch.setattr(stripe_client.supabase, "rpc", rpc, raising=False)

    outcome = stripe_client._finalize_reservation_from_pi(PI)

    assert outcome["reservation_id"] == "55555555-5555-5555-5555-555555555555"


def test_persistent_deadlock_gives_up_and_is_refundable(stripe_client, monkeypatch):
    """Exhausted retries must surface a TERMINAL error so the capture is given
    back, rather than a retryable one that nothing ever retries."""
    rpc = _ScriptedRpc([_err(DEADLOCK)])
    monkeypatch.setattr(stripe_client.supabase, "rpc", rpc, raising=False)

    outcome = stripe_client._finalize_reservation_from_pi(PI)

    assert rpc.calls == stripe_client._FINALIZE_MAX_ATTEMPTS
    assert outcome["error"] == DEADLOCK
    assert stripe_client._is_terminal_finalize_error(outcome["error"]) is True


def test_the_loser_of_a_real_race_is_not_retried(stripe_client, monkeypatch):
    """slot_unavailable is a decision, not a collision. Retrying it would just
    delay the refund the renter is owed."""
    rpc = _ScriptedRpc([_err("slot_unavailable")])
    monkeypatch.setattr(stripe_client.supabase, "rpc", rpc, raising=False)

    outcome = stripe_client._finalize_reservation_from_pi(PI)

    assert rpc.calls == 1
    assert outcome["error"] == "slot_unavailable"


def test_success_does_not_retry(stripe_client, monkeypatch):
    rpc = _ScriptedRpc([_ok()])
    monkeypatch.setattr(stripe_client.supabase, "rpc", rpc, raising=False)

    stripe_client._finalize_reservation_from_pi(PI)

    assert rpc.calls == 1

"""Tests for renter-initiated booking cancellation (services.payouts.cancel_reservation).

Added alongside the feature itself: a renter can cancel a confirmed booking for
a full refund once more than CANCELLATION_WINDOW_HOURS out from start_time.

WHAT THESE PIN
  * ownership, payout_status eligibility, and the time window are all
    enforced, in an order that never touches Stripe before every check passes
  * the double-tap / re-mount race: two calls racing on the same reservation
    must never both reach stripe.Refund.create -- the row is atomically
    claimed (a conditional UPDATE) before Stripe is ever touched, so the
    loser bails at 409 without a second refund
  * a failed Stripe call releases the claim (back to 'held') so cancellation
    is retryable instead of leaving the row stuck as 'refunding'
  * CANCELLATION_WINDOW_HOURS is read from the environment per call, not
    baked in at import time

WHAT THESE DO NOT COVER
  Real concurrency (actual threads/processes racing inside Postgres) -- that
  needs a live database. What's pinned here is that the same conditional
  UPDATE call sequence used in production, replayed sequentially against a
  fake DB that mutates state exactly like Postgres does under this WHERE
  clause, prevents a second refund -- which is exactly what a losing
  concurrent request would see once Postgres re-checks its WHERE clause
  after the winner's row lock clears.
"""
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

USER = "44444444-4444-4444-8444-444444444444"
OTHER = "55555555-5555-4555-8555-555555555555"
RES_ID = "r-cancel-1"


class _Query:
    """Chainable stand-in for the PostgREST query builder, update() included.

    update() both mutates the matched rows in place (so a later query in the
    same test sees the new state) and returns them as `.data` -- exactly
    supabase-py's default `Prefer: return=representation` behavior, which is
    what cancel_reservation's atomic claim relies on to know whether it won.
    """

    def __init__(self, db, table, verb, payload=None):
        self.db, self.table, self.verb, self.payload = db, table, verb, payload
        self.filters = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def _matches(self, row):
        return all(row.get(k) == v for k, v in self.filters.items())

    def execute(self):
        self.db.calls.append((self.table, self.verb, dict(self.filters), self.payload))
        matched = [r for r in self.db.rows.get(self.table, []) if self._matches(r)]
        if self.verb == "update":
            for r in matched:
                r.update(self.payload)
            return type("R", (), {"data": list(matched)})()
        # select: return snapshots, not live references. A later mutation
        # (e.g. a "concurrent" call's update) must not retroactively change
        # what an earlier read already saw -- matches real Postgres MVCC
        # semantics, and is what makes the TOCTOU race test below meaningful
        # instead of accidentally seeing the post-mutation state.
        return type("R", (), {"data": [dict(r) for r in matched]})()


class _FakeDB:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def table(self, name):
        outer = self

        class _T:
            def select(_s, *a, **k):
                return _Query(outer, name, "select")

            def update(_s, payload):
                return _Query(outer, name, "update", payload)

        return _T()


class _FakeRefund:
    """Minimal stand-in for stripe.Refund, recording what it was asked to do."""

    def __init__(self, explode=False):
        self.explode = explode
        self.created = []

    def create(self, **kwargs):
        if self.explode:
            raise RuntimeError("stripe is down")
        self.created.append(kwargs)
        return types.SimpleNamespace(id="re_cancel_test")


@pytest.fixture
def app_ctx():
    """jsonify() needs one; cancel_reservation returns jsonify(...) directly."""
    from flask import Flask
    app = Flask(__name__)
    with app.app_context():
        yield app


@pytest.fixture
def payouts(monkeypatch):
    """Import services.payouts fresh with supabase stubbed, as the sibling tests do.

    supabase_client builds a live client at import time; none of that is what
    these tests are about. Real `stripe` stays real (it needs no env vars to
    import) -- only stripe.Refund gets swapped per-test below.
    """
    stub = types.ModuleType("services.supabase_client")
    stub.supabase = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "services.supabase_client", stub)
    monkeypatch.delitem(sys.modules, "services.payouts", raising=False)
    import services.payouts as mod
    return mod


def _in_hours(hours):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _res(**over):
    row = {
        "id": RES_ID,
        "renter_id": USER,
        "status": "confirmed",
        "payout_status": "held",
        "start_time": _in_hours(48),
        "stripe_payment_intent": "pi_cancel_test",
    }
    row.update(over)
    return row


# ── eligibility, checked in order, before Stripe is ever touched ─────────────

def test_reservation_not_found(payouts, monkeypatch, app_ctx):
    db = _FakeDB({"reservations": []})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    _resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 404
    assert fake_refund.created == []


def test_someone_elses_reservation_is_refused(payouts, monkeypatch, app_ctx):
    db = _FakeDB({"reservations": [_res(renter_id=OTHER)]})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    _resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 403
    assert fake_refund.created == []


def test_already_past_held_cannot_be_cancelled(payouts, monkeypatch, app_ctx):
    """payout_ready/paid_out/refunded/etc -- the stay has started, or a
    transfer/refund is already in flight. Either way, past the point of no
    return, and NOT gated on the time window (a payout_ready booking could
    still be numerically "24 hours out" if the sweep ran early)."""
    db = _FakeDB({"reservations": [_res(payout_status="payout_ready")]})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    _resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 409
    assert fake_refund.created == []


def test_inside_the_default_window_is_refused(payouts, monkeypatch, app_ctx):
    db = _FakeDB({"reservations": [_res(start_time=_in_hours(2))]})
    monkeypatch.setattr(payouts, "supabase", db)
    monkeypatch.delenv("CANCELLATION_WINDOW_HOURS", raising=False)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 409
    assert "24" in resp.get_json()["error"]
    assert fake_refund.created == []


def test_the_window_is_read_from_the_environment(payouts, monkeypatch, app_ctx):
    """A shorter configured window makes an otherwise-too-late cancellation legal."""
    db = _FakeDB({"reservations": [_res(start_time=_in_hours(2))]})
    monkeypatch.setattr(payouts, "supabase", db)
    monkeypatch.setenv("CANCELLATION_WINDOW_HOURS", "1")
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    _resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 200
    assert len(fake_refund.created) == 1


def test_no_payment_on_file_is_refused(payouts, monkeypatch, app_ctx):
    db = _FakeDB({"reservations": [_res(stripe_payment_intent=None)]})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    _resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 409
    assert fake_refund.created == []


# ── the happy path ────────────────────────────────────────────────────────────

def test_a_valid_cancellation_refunds_and_marks_the_row(payouts, monkeypatch, app_ctx):
    db = _FakeDB({"reservations": [_res()]})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 200
    assert resp.get_json() == {"reservation_id": RES_ID, "refunded": True}
    assert fake_refund.created == [{"payment_intent": "pi_cancel_test"}]
    row = db.rows["reservations"][0]
    assert row["status"] == "cancelled"
    assert row["payout_status"] == "refunded"


# ── the race: two calls, only one refund ─────────────────────────────────────

def test_calling_cancel_twice_in_a_row_only_refunds_once(payouts, monkeypatch, app_ctx):
    """The coarse case: by the time a second call starts, the first has
    already finished, so the early payout_status != 'held' check alone
    catches it -- before the atomic claim is even reached. Only one refund
    either way, which is the property that actually matters here."""
    db = _FakeDB({"reservations": [_res()]})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    _resp1, status1 = payouts.cancel_reservation(RES_ID, USER)
    resp2, status2 = payouts.cancel_reservation(RES_ID, USER)

    assert status1 == 200
    assert status2 == 409
    assert len(fake_refund.created) == 1, "a double-tap must not fire a second refund"


def test_two_requests_reading_held_before_either_commits_still_only_refund_once(payouts, monkeypatch, app_ctx):
    """The actual TOCTOU window the atomic claim exists for: two requests
    whose initial SELECT both land while the row still says 'held', before
    either has run its claim-update. The early eligibility check alone can't
    catch this -- both requests pass it -- so this is what would double-refund
    without the conditional UPDATE.

    Simulated by hooking the fake DB's query execution: the instant the
    OUTER call's own initial SELECT returns, fire a fully nested INNER call
    for the same reservation before the outer call proceeds any further. The
    inner call runs to completion (including its own claim-update and
    Stripe.Refund.create) while the outer call is paused mid-function, so
    when the outer call resumes and attempts ITS claim-update, the row is no
    longer 'held' and it loses -- exactly what a real second Postgres
    transaction sees once the winner's row lock clears and its WHERE clause
    is re-checked.
    """
    db = _FakeDB({"reservations": [_res()]})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund()
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    original_execute = _Query.execute
    fired = {"done": False}
    inner_result = {}

    def racing_execute(self):
        result = original_execute(self)
        if self.verb == "select" and self.filters.get("id") == RES_ID and not fired["done"]:
            fired["done"] = True  # set BEFORE recursing, or the inner call re-triggers this too
            inner_result["value"] = payouts.cancel_reservation(RES_ID, USER)
        return result

    monkeypatch.setattr(_Query, "execute", racing_execute)

    resp_outer, status_outer = payouts.cancel_reservation(RES_ID, USER)
    resp_inner, status_inner = inner_result["value"]

    # The inner call runs to completion first, so it wins the claim; the
    # outer call resumes afterward and loses. Assert on the invariant that
    # actually matters rather than which one wins.
    assert {status_outer, status_inner} == {200, 409}
    loser_resp = resp_outer if status_outer == 409 else resp_inner
    assert "already being cancelled" in loser_resp.get_json()["error"]
    assert len(fake_refund.created) == 1, "both requests saw 'held' before either committed -- must still refund once"


def test_a_failed_refund_releases_the_claim_so_it_is_retryable(payouts, monkeypatch, app_ctx):
    db = _FakeDB({"reservations": [_res()]})
    monkeypatch.setattr(payouts, "supabase", db)
    fake_refund = _FakeRefund(explode=True)
    monkeypatch.setattr(payouts.stripe, "Refund", fake_refund)

    _resp, status = payouts.cancel_reservation(RES_ID, USER)

    assert status == 502
    row = db.rows["reservations"][0]
    assert row["payout_status"] == "held", "must not be left stuck as 'refunding'"

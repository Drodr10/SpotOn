"""The two money-path endpoints that took an opaque id and no caller identity.

`/api/stripe/release-hold` accepted a hold_id and deleted that hold. A hold_id
was therefore enough to drop someone else's slot in the middle of their
checkout. `/api/stripe/finalize-booking` accepted a payment_intent_id and acted
on it, unauthenticated.

WHAT THESE PIN
  * both routes reject an unauthenticated request outright
  * releasing scopes the DELETE to the caller *inside the query*, so there is
    no window between checking ownership and deleting, and no way to probe
    whether a hold id exists
  * finalizing refuses a PaymentIntent whose metadata names a different renter
  * and — the one that matters most — that refusal happens BEFORE the refund
    path can run. An ownership check placed after it would let a stranger
    trigger a refund of someone else's succeeded payment, which is a worse bug
    than the one being fixed.

WHAT THESE DO NOT COVER
  Real Stripe calls and a real Postgres. The Stripe surface is faked and the
  Supabase client is a filter-applying stand-in, same as the sibling tests.
"""
import sys
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

USER = "11111111-1111-4111-8111-111111111111"
OTHER = "99999999-9999-4999-8999-999999999999"
HOLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


# ── a Supabase stand-in that actually applies filters ────────────────────────

class _Query:
    def __init__(self, db, table, verb):
        self.db, self.table, self.verb = db, table, verb
        self.filters = {}

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def select(self, *_a, **_k):
        return self

    def execute(self):
        self.db.calls.append((self.table, self.verb, dict(self.filters)))
        rows = self.db.rows.get(self.table, [])
        hit = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items())]
        if self.verb == "delete":
            self.db.rows[self.table] = [r for r in rows if r not in hit]
        return type("R", (), {"data": hit})()


class _FakeDB:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def table(self, name):
        outer = self

        class _T:
            def delete(_s):
                return _Query(outer, name, "delete")

            def select(_s, *a, **k):
                return _Query(outer, name, "select")

        return _T()


@pytest.fixture
def app_ctx():
    """jsonify() needs one; these functions return jsonify(...) directly."""
    from flask import Flask
    app = Flask(__name__)
    with app.app_context():
        yield app


@pytest.fixture
def sc(monkeypatch):
    """services.stripe_client with its heavy imports stubbed, as the sibling tests do."""
    for name, attrs in {
        "services.supabase_client": {"supabase": types.SimpleNamespace()},
        "services.payouts": {"_parse_ts": lambda *_a: None,
                             "release_pending_for_account": lambda *_a: 0,
                             "run_payout_sweep": lambda *_a: {}},
        "services.notifications": {"send_booking_notifications": lambda *_a: {},
                                   "run_notification_sweep": lambda *_a: {}},
    }.items():
        module = types.ModuleType(name)
        for attr, value in attrs.items():
            setattr(module, attr, value)
        monkeypatch.setitem(sys.modules, name, module)

    monkeypatch.delitem(sys.modules, "services.stripe_client", raising=False)
    import services.stripe_client as mod
    return mod


# ── release-hold: scoped to the caller ───────────────────────────────────────

def _hold(owner=USER):
    return {"id": HOLD, "renter_id": owner, "listing_id": "L1"}


def test_a_hold_belonging_to_someone_else_survives(sc, monkeypatch, app_ctx):
    """The whole point: a hold_id must not be enough to drop another renter's slot."""
    db = _FakeDB({"reservation_holds": [_hold(owner=OTHER)]})
    monkeypatch.setattr(sc, "supabase", db)

    resp, status = sc.release_booking_hold(HOLD, USER)

    assert status == 200
    assert resp.get_json()["released"] is False
    assert db.rows["reservation_holds"] == [_hold(owner=OTHER)], "someone else's hold was deleted"


def test_your_own_hold_is_released(sc, monkeypatch, app_ctx):
    db = _FakeDB({"reservation_holds": [_hold(owner=USER)]})
    monkeypatch.setattr(sc, "supabase", db)

    resp, status = sc.release_booking_hold(HOLD, USER)

    assert status == 200 and resp.get_json()["released"] is True
    assert db.rows["reservation_holds"] == []


def test_ownership_is_enforced_inside_the_delete_not_before_it(sc, monkeypatch, app_ctx):
    """No read-then-delete: that reintroduces a window and leaks existence."""
    db = _FakeDB({"reservation_holds": [_hold()]})
    monkeypatch.setattr(sc, "supabase", db)

    sc.release_booking_hold(HOLD, USER)

    assert [c[1] for c in db.calls] == ["delete"], f"expected one DELETE, got {db.calls}"
    assert db.calls[0][2] == {"id": HOLD, "renter_id": USER}


def test_a_missing_hold_id_is_rejected(sc, monkeypatch, app_ctx):
    db = _FakeDB({"reservation_holds": [_hold()]})
    monkeypatch.setattr(sc, "supabase", db)

    _resp, status = sc.release_booking_hold(None, USER)

    assert status == 400
    assert db.calls == [], "must not touch the table without an id"


# ── finalize-booking: the PaymentIntent must be the caller's ─────────────────

def _pi(renter=USER, **md_over):
    md = {"listing_id": "L1", "renter_id": renter, "vehicle_id": "V1",
          "start_time": "2026-09-01T10:00:00Z", "end_time": "2026-09-01T12:00:00Z"}
    md.update(md_over)
    return {"id": "pi_test_123", "status": "succeeded", "metadata": md,
            "latest_charge": "ch_1"}


@pytest.fixture
def spies(sc, monkeypatch):
    """Record whether the booking and refund paths were reached at all."""
    # `outcome` is settable so a test can make the booking fail terminally,
    # which is the only way the refund path downstream becomes reachable.
    seen = {"finalized": 0, "refunded": 0, "outcome": {"reservation_id": "r-1"}}

    def _fin(_pi):
        seen["finalized"] += 1
        return seen["outcome"]

    def _refund(_pi_id, _reason):
        seen["refunded"] += 1
        return "refunded"

    monkeypatch.setattr(sc, "_finalize_reservation_from_pi", _fin)
    monkeypatch.setattr(sc, "_refund_stranded_payment", _refund)
    return seen


def _stub_retrieve(sc, monkeypatch, pi):
    monkeypatch.setattr(sc, "stripe", types.SimpleNamespace(
        api_key=None,
        PaymentIntent=types.SimpleNamespace(retrieve=lambda *_a, **_k: pi),
    ))


def test_finalizing_someone_elses_payment_is_refused(sc, monkeypatch, spies, app_ctx):
    _stub_retrieve(sc, monkeypatch, _pi(renter=OTHER))

    resp, status = sc.finalize_booking("pi_test_123", USER)

    assert status == 403
    assert spies["finalized"] == 0, "must not create the reservation"


def test_a_refused_finalize_never_reaches_the_refund_path(sc, monkeypatch, spies, app_ctx):
    """The ordering test.

    This PaymentIntent is BOTH someone else's and missing metadata that would
    classify as terminal — i.e. it would refund if the ownership check ran too
    late. A stranger being able to refund a succeeded payment is worse than a
    stranger being able to finalize one.
    """
    pi = _pi(renter=OTHER)
    del pi["metadata"]["vehicle_id"]
    _stub_retrieve(sc, monkeypatch, pi)
    # Terminal, so the refund path IS reachable if the check runs too late.
    # Without this the test passes against a misordered check and proves nothing.
    spies["outcome"] = {"error": "missing_metadata: vehicle_id"}

    _resp, status = sc.finalize_booking("pi_test_123", USER)

    assert status == 403
    assert spies["finalized"] == 0, "the booking was attempted for a stranger"
    assert spies["refunded"] == 0, "a stranger triggered a refund of someone else's payment"


def test_the_refusal_says_nothing_about_the_payment(sc, monkeypatch, spies, app_ctx):
    """Otherwise the endpoint is an oracle for whether a PI id is real."""
    _stub_retrieve(sc, monkeypatch, _pi(renter=OTHER))

    resp, _status = sc.finalize_booking("pi_test_123", USER)

    body = resp.get_json()
    assert body == {"error": "Forbidden"}, f"leaks detail: {body}"


def test_the_payer_can_finalize_their_own_payment(sc, monkeypatch, spies, app_ctx):
    _stub_retrieve(sc, monkeypatch, _pi(renter=USER))

    resp, status = sc.finalize_booking("pi_test_123", USER)

    assert status == 200
    assert resp.get_json()["reservationId"] == "r-1"
    assert spies["finalized"] == 1


def test_an_unpaid_payment_is_still_rejected_first(sc, monkeypatch, spies, app_ctx):
    """The pre-existing status gate must survive the new check."""
    pi = _pi(renter=USER)
    pi["status"] = "requires_payment_method"
    _stub_retrieve(sc, monkeypatch, pi)

    _resp, status = sc.finalize_booking("pi_test_123", USER)

    assert status == 409
    assert spies["finalized"] == 0


# ── the routes themselves are gated ──────────────────────────────────────────

def test_both_routes_reject_an_unauthenticated_request(sc, monkeypatch):
    """End-to-end through Flask: no Authorization header, no access.

    Uses the real token_required, which rejects a missing header before it
    would touch the network.
    """
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    for name in ("services.auth", "routes.stripe"):
        monkeypatch.delitem(sys.modules, name, raising=False)

    from flask import Flask
    import routes.stripe as routes_stripe

    app = Flask(__name__)
    app.register_blueprint(routes_stripe.stripe_bp, url_prefix="/api")
    client = app.test_client()

    for path, payload in (
        ("/api/stripe/release-hold", {"hold_id": HOLD}),
        ("/api/stripe/finalize-booking", {"payment_intent_id": "pi_test_123"}),
    ):
        resp = client.post(path, json=payload)
        assert resp.status_code == 401, f"{path} answered {resp.status_code} with no token"

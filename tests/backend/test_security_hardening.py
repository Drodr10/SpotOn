"""Backend halves of the 2026-11-16 security hardening batch.

WHAT THESE PIN
  * POST /api/reservations is retired (410) and creates nothing. It used to
    insert unpaid 'pending' bookings with no PaymentIntent that never expired,
    so anyone signed in could block any listing's calendar for free.
  * the payout sweep now cancels those leftovers: 'pending' /
    'pending_payment' rows with no PaymentIntent, older than
    PENDING_EXPIRY_MINUTES. Fresh rows, rows that picked up a PaymentIntent in
    the meantime and confirmed rows are left alone, and a database error on
    one row does not stop the sweep.
  * GET /api/conversations/<user_id> embeds only the other party's public
    profile fields, never profiles(*) (email, push token, Stripe account id).
  * the Stripe webhook refuses every event (500) when STRIPE_WEBHOOK_SECRET is
    unset, unless ALLOW_UNSIGNED_WEBHOOKS=1 is set for local development.
  * /api/stripe/onboarding-complete (Stripe's browser return_url, no token)
    can only trigger the Stripe-sourced re-sync, ignores malformed ids, and
    answers with the same page whatever id it is given.
  * GET /api/listings/<id> hides an inactive listing (404, same as a missing
    one) from everyone but its owner.

WHAT THESE DO NOT COVER
  Real Stripe or a real Postgres. Supabase is a filter-applying stand-in and
  Stripe is faked, as in the sibling tests. The database grants that go with
  this batch are pinned by supabase/tests/database/security_hardening.test.sql.
"""
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from postgrest.exceptions import APIError

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

USER = "61616161-6161-4161-8161-616161616161"
OTHER = "62626262-6262-4262-8262-626262626262"
LISTING = "a6a6a6a6-6666-4666-8666-666666666666"


# ── a Supabase stand-in that applies the filters these code paths use ────────

class _Query:
    def __init__(self, db, table, verb, payload=None):
        self.db, self.table, self.verb, self.payload = db, table, verb, payload
        self.filters = []
        self.selected = None

    def select(self, cols="*", *_a, **_k):
        self.selected = cols
        return self

    def eq(self, col, val):
        self.filters.append(lambda r, c=col, v=val: r.get(c) == v)
        return self

    def is_(self, col, val):
        assert val == "null", "only IS NULL is used here"
        self.filters.append(lambda r, c=col: r.get(c) is None)
        return self

    def lte(self, col, val):
        self.filters.append(lambda r, c=col, v=val: r.get(c) is not None and r.get(c) <= v)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r, c=col, v=tuple(vals): r.get(c) in v)
        return self

    def or_(self, _expr):
        return self

    def execute(self):
        self.db.calls.append((self.table, self.verb, self.selected, self.payload))
        boom = self.db.fail.get((self.table, self.verb))
        if boom:
            raise boom
        rows = self.db.rows.setdefault(self.table, [])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.verb == "update":
            for r in hit:
                r.update(self.payload)
            return types.SimpleNamespace(data=[dict(r) for r in hit])
        if self.verb == "delete":
            self.db.rows[self.table] = [r for r in rows if r not in hit]
        return types.SimpleNamespace(data=[dict(r) for r in hit])


class _FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.calls = []
        self.fail = {}

    def table(self, name):
        db = self

        class _T:
            def select(_s, *a, **k):
                return _Query(db, name, "select").select(*a, **k)

            def update(_s, payload):
                return _Query(db, name, "update", payload)

            def delete(_s):
                return _Query(db, name, "delete")

        return _T()


def _api_error(message="permission denied for table reservations", code="42501"):
    return APIError({"message": message, "code": code, "hint": None, "details": None})


# ── POST /api/reservations is retired ────────────────────────────────────────

@pytest.fixture
def reservations_app(monkeypatch):
    db = _FakeDB()
    stub = types.ModuleType("services.supabase_client")
    stub.supabase = db
    monkeypatch.setitem(sys.modules, "services.supabase_client", stub)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    for name in ("services.auth", "routes.reservations"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    from flask import Flask
    import routes.reservations as mod

    app = Flask(__name__)
    app.register_blueprint(mod.reservations_bp, url_prefix="/api")
    return app.test_client(), db


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer anything"}])
def test_post_reservations_is_gone_and_touches_nothing(reservations_app, headers):
    client, db = reservations_app

    resp = client.post("/api/reservations", headers=headers, json={
        "listing_id": LISTING, "vehicle_id": "v1",
        "start_time": "2026-12-01T10:00:00Z", "end_time": "2026-12-01T12:00:00Z",
    })

    assert resp.status_code == 410
    assert "create-booking-payment" in resp.get_json()["error"]
    assert db.calls == [], "the retired route must not read or write anything"


# ── the sweep clears unpaid, PaymentIntent-less 'pending' rows ───────────────

@pytest.fixture
def payouts(monkeypatch):
    stub = types.ModuleType("services.supabase_client")
    stub.supabase = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "services.supabase_client", stub)
    monkeypatch.delitem(sys.modules, "services.payouts", raising=False)
    import services.payouts as mod

    retrieved = []

    def _retrieve(pi_id):
        retrieved.append(pi_id)
        return types.SimpleNamespace(status="requires_payment_method")

    monkeypatch.setattr(mod, "stripe", types.SimpleNamespace(
        api_key=None,
        PaymentIntent=types.SimpleNamespace(retrieve=_retrieve, cancel=lambda *_a, **_k: None),
    ))
    mod._retrieved = retrieved
    return mod


def _ago(payouts, minutes):
    return payouts._iso(datetime.now(timezone.utc) - timedelta(minutes=minutes))


def _row(rid, **over):
    row = {"id": rid, "listing_id": LISTING, "renter_id": USER, "status": "pending",
           "payout_status": "pending_payment", "stripe_payment_intent": None}
    row.update(over)
    return row


def _by_id(db):
    return {r["id"]: r for r in db.rows["reservations"]}


def test_sweep_cancels_stale_unpaid_pending_rows(payouts, monkeypatch):
    db = _FakeDB({"reservations": [
        _row("junk-old", created_at=_ago(payouts, 90)),
        _row("junk-fresh", created_at=_ago(payouts, 5)),
        _row("confirmed-no-pi", status="confirmed", created_at=_ago(payouts, 90)),
        _row("abandoned-checkout", stripe_payment_intent="pi_abandoned",
             created_at=_ago(payouts, 90)),
    ], "reservation_holds": []})
    monkeypatch.setattr(payouts, "supabase", db)

    summary = payouts.run_payout_sweep()

    rows = _by_id(db)
    assert rows["junk-old"]["status"] == "cancelled"
    assert rows["junk-old"]["payout_status"] == "cancelled"
    assert rows["junk-fresh"]["status"] == "pending", "a row inside the 30-minute window was cancelled"
    assert rows["confirmed-no-pi"]["status"] == "confirmed", "a confirmed booking was cancelled"
    # The existing PaymentIntent path is unchanged: Stripe is asked, then cancelled.
    assert rows["abandoned-checkout"]["status"] == "cancelled"
    assert payouts._retrieved == ["pi_abandoned"]
    assert summary["expired_unpaid"] == 1
    assert summary["expired"] == 1


def test_sweep_cancel_is_conditional_on_the_row_still_being_unpaid(payouts, monkeypatch):
    """If the webhook attaches a PaymentIntent between the read and the cancel,
    the conditional UPDATE matches nothing and the booking survives."""
    db = _FakeDB({"reservations": [
        _row("raced", stripe_payment_intent="pi_just_paid", payout_status="held",
             status="confirmed", created_at=_ago(payouts, 90)),
    ]})
    monkeypatch.setattr(payouts, "supabase", db)

    assert payouts._cancel_unpaid_pending("raced") is False
    assert _by_id(db)["raced"]["status"] == "confirmed"


def test_a_database_error_on_the_cancel_does_not_stop_the_sweep(payouts, monkeypatch):
    db = _FakeDB({"reservations": [_row("junk-old", created_at=_ago(payouts, 90))],
                  "reservation_holds": []})
    db.fail[("reservations", "update")] = _api_error()
    monkeypatch.setattr(payouts, "supabase", db)

    summary = payouts.run_payout_sweep()

    assert summary["expired_unpaid"] == 0
    # The sweep carried on to its last step (hold cleanup).
    assert ("reservation_holds", "delete", None, None) in db.calls


# ── GET /api/conversations/<user_id>: public profile fields only ─────────────

def _stub_auth(monkeypatch, user_id=USER, optional=None):
    """services.auth with token_required injecting a fixed caller."""
    from functools import wraps

    def token_required(f):
        @wraps(f)
        def inner(*a, **k):
            return f(user_id, *a, **k)
        return inner

    mod = types.ModuleType("services.auth")
    mod.token_required = token_required
    mod.optional_user_id = lambda: optional
    monkeypatch.setitem(sys.modules, "services.auth", mod)


def test_conversations_embed_only_public_profile_columns(monkeypatch):
    db = _FakeDB({"conversations": [{"id": "c1", "renter_id": OTHER, "owner_id": USER}]})
    stub = types.ModuleType("services.supabase_client")
    stub.supabase = db
    monkeypatch.setitem(sys.modules, "services.supabase_client", stub)
    _stub_auth(monkeypatch)
    monkeypatch.delitem(sys.modules, "routes.messages", raising=False)
    from flask import Flask
    import routes.messages as mod

    app = Flask(__name__)
    app.register_blueprint(mod.messages_bp, url_prefix="/api")
    resp = app.test_client().get(f"/api/conversations/{USER}")

    assert resp.status_code == 200
    selected = [c[2] for c in db.calls if c[0] == "conversations"][0]
    assert "profiles!renter_id(id, full_name, avatar_url)" in selected
    assert "profiles!renter_id(*)" not in selected
    for private in ("email", "expo_push_token", "stripe_account_id", "payouts_enabled"):
        assert private not in selected, f"{private} is embedded in the conversations response"


# ── Stripe webhook: no secret, no events ─────────────────────────────────────

@pytest.fixture
def stripe_client(monkeypatch):
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

    monkeypatch.setattr(sc, "webhookSecret", None)
    monkeypatch.delenv("ALLOW_UNSIGNED_WEBHOOKS", raising=False)
    handled = []
    monkeypatch.setattr(sc, "_on_payment_succeeded", lambda obj: handled.append(obj))
    sc._handled = handled
    return sc


@pytest.fixture
def app_ctx():
    from flask import Flask
    app = Flask(__name__)
    with app.app_context():
        yield app


_FORGED = (b'{"id":"evt_forged","object":"event","type":"payment_intent.succeeded",'
           b'"data":{"object":{"id":"pi_forged","metadata":{}}}}')


def test_unsigned_webhook_is_refused_when_the_secret_is_unset(stripe_client, app_ctx):
    resp, status = stripe_client.handle_webhook(_FORGED, "")

    assert status == 500
    assert "not configured" in resp.get_json()["error"]
    assert stripe_client._handled == [], "a forged event was processed"


@pytest.mark.parametrize("flag", ["0", "true", "yes", ""])
def test_only_the_exact_dev_flag_allows_unsigned_webhooks(stripe_client, app_ctx, monkeypatch, flag):
    monkeypatch.setenv("ALLOW_UNSIGNED_WEBHOOKS", flag)

    _resp, status = stripe_client.handle_webhook(_FORGED, "")

    assert status == 500
    assert stripe_client._handled == []


def test_dev_flag_allows_unsigned_webhooks_locally(stripe_client, app_ctx, monkeypatch):
    monkeypatch.setenv("ALLOW_UNSIGNED_WEBHOOKS", "1")

    _resp, status = stripe_client.handle_webhook(_FORGED, "")

    assert status == 200
    assert len(stripe_client._handled) == 1


def test_with_a_secret_an_unsigned_webhook_is_still_rejected(stripe_client, app_ctx, monkeypatch):
    """The dev flag must not weaken a configured secret."""
    monkeypatch.setattr(stripe_client, "webhookSecret", "whsec_configured")
    monkeypatch.setenv("ALLOW_UNSIGNED_WEBHOOKS", "1")

    _resp, status = stripe_client.handle_webhook(_FORGED, "t=1,v1=bogus")

    assert status == 400
    assert stripe_client._handled == []


# ── /api/stripe/onboarding-complete: harmless re-sync, no oracle ─────────────

@pytest.fixture
def stripe_routes(monkeypatch):
    synced = []

    def _sync(user_id):
        synced.append(user_id)
        if user_id == OTHER:
            raise RuntimeError("stripe down")
        return ({}, 200)

    sc = types.ModuleType("services.stripe_client")
    for name in ("publishableKey", "create_booking_payment", "release_booking_hold",
                 "finalize_booking", "createConnectAccount", "createAccountLink",
                 "handle_webhook"):
        setattr(sc, name, lambda *_a, **_k: None)
    sc.sync_connect_account = _sync
    pay = types.ModuleType("services.payouts")
    pay.run_payout_sweep = lambda: {}
    pay.cancel_reservation = lambda *_a: ({}, 200)
    notif = types.ModuleType("services.notifications")
    notif.run_notification_sweep = lambda: {}
    for name, mod in (("services.stripe_client", sc), ("services.payouts", pay),
                      ("services.notifications", notif)):
        monkeypatch.setitem(sys.modules, name, mod)
    _stub_auth(monkeypatch)
    monkeypatch.delitem(sys.modules, "routes.stripe", raising=False)
    from flask import Flask
    import routes.stripe as mod

    app = Flask(__name__)
    app.register_blueprint(mod.stripe_bp, url_prefix="/api")
    return app.test_client(), synced


def test_onboarding_return_answers_the_same_for_any_id(stripe_routes):
    client, synced = stripe_routes

    bodies = set()
    for query in (f"?user_id={USER}", f"?user_id={OTHER}", "?user_id=not-a-uuid",
                  "?user_id=1%27%20or%201=1", ""):
        resp = client.get(f"/api/stripe/onboarding-complete{query}")
        assert resp.status_code == 200
        bodies.add(resp.get_data())

    assert len(bodies) == 1, "the response differs by user_id (enumeration oracle)"
    # Only well-formed ids reach the (Stripe-sourced) re-sync; a failing sync is swallowed.
    assert synced == [USER, OTHER]


def test_onboarding_complete_no_longer_force_enables_payouts():
    """The old onboardingComplete() set payouts_enabled=True without asking
    Stripe. Nothing may call it again."""
    src = (REPO_ROOT / "backend" / "services" / "stripe_client.py").read_text()
    routes_src = (REPO_ROOT / "backend" / "routes" / "stripe.py").read_text()
    assert "def onboardingComplete" not in src
    assert "onboardingComplete" not in routes_src


# ── GET /api/listings/<id>: inactive listings are the owner's business ──────

def _listings_client(monkeypatch, listing, caller):
    db = _FakeDB({"listings": [listing] if listing else []})
    stub = types.ModuleType("services.supabase_client")
    stub.supabase = db
    monkeypatch.setitem(sys.modules, "services.supabase_client", stub)
    _stub_auth(monkeypatch, optional=caller)
    monkeypatch.delitem(sys.modules, "routes.listings", raising=False)
    from flask import Flask
    import routes.listings as mod

    app = Flask(__name__)
    app.register_blueprint(mod.listings_bp, url_prefix="/api")
    return app.test_client()


def _listing(active):
    return {"id": LISTING, "owner_id": USER, "address": "1 Test St", "is_active": active}


@pytest.mark.parametrize("active, caller, expected", [
    (True, None, 200),     # public listing, anyone
    (True, OTHER, 200),
    (False, None, 404),    # deactivated: hidden from the public
    (False, OTHER, 404),   # ...and from other signed-in users
    (False, USER, 200),    # ...but its owner still sees it
    (None, None, 404),     # NULL is_active is treated as inactive, as GET /listings does
])
def test_get_listing_hides_inactive_listings_from_non_owners(monkeypatch, active, caller, expected):
    client = _listings_client(monkeypatch, _listing(active), caller)

    resp = client.get(f"/api/listings/{LISTING}")

    assert resp.status_code == expected


def test_hidden_listing_looks_exactly_like_a_missing_one(monkeypatch):
    hidden = _listings_client(monkeypatch, _listing(False), None).get(f"/api/listings/{LISTING}")
    missing = _listings_client(monkeypatch, None, None).get(f"/api/listings/{LISTING}")

    assert (hidden.status_code, hidden.get_json()) == (missing.status_code, missing.get_json())


def test_optional_user_id_treats_anything_but_a_valid_token_as_anonymous(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delitem(sys.modules, "services.auth", raising=False)
    from flask import Flask
    import services.auth as auth

    app = Flask(__name__)
    for headers in ({}, {"Authorization": "Bearer"}, {"Authorization": "Basic abc"},
                    {"Authorization": "Bearer not.a.jwt"}):
        with app.test_request_context("/", headers=headers):
            assert auth.optional_user_id() is None, headers

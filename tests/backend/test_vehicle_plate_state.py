"""Vehicle routes: plate_state validation and the active-booking lock.

WHAT THESE PIN
  * creating a vehicle requires a valid two-letter US plate_state, upper-cased
  * updating validates plate_state when sent and leaves it alone when not
  * when Postgres refuses an edit/delete because the car is on an unfinished
    booking (trg_guard_vehicle_in_active_booking, 20261116140000), the route
    answers 409 with a stable `code`, not a 500
  * any other database error still propagates

WHAT THESE DO NOT COVER
  The trigger itself — that needs a real Postgres. Auth is replaced with a
  pass-through that injects a fixed user id; Supabase is a recording stand-in.
"""
import sys
import types
from functools import wraps
from pathlib import Path

import pytest
from postgrest.exceptions import APIError

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

USER = "11111111-1111-4111-8111-111111111111"
VEHICLE = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv"
LOCK_MSG = ("This car is on a booking that has not finished yet. "
            "You can change or remove it once the booking ends.")
HOLD_MSG = ("This car is being used for a booking that is checking out right now. "
            "Try again in a few minutes.")


def _pg_error(message, code):
    # The real client exception, so a postgrest change to how it stringifies
    # breaks these tests rather than production.
    return APIError({"message": message, "code": code, "details": None, "hint": None})


class _Query:
    def __init__(self, db, verb, payload=None):
        self.db, self.verb, self.payload = db, verb, payload

    def eq(self, *_a):
        return self

    def execute(self):
        self.db.calls.append((self.verb, self.payload))
        if self.db.raise_on_execute is not None:
            raise self.db.raise_on_execute
        return types.SimpleNamespace(data=[{"id": VEHICLE, **(self.payload or {})}])


class _FakeDB:
    def __init__(self):
        self.calls = []
        self.raise_on_execute = None

    def table(self, _name):
        db = self

        class _T:
            def insert(_s, payload):
                return _Query(db, "insert", payload)

            def update(_s, payload):
                return _Query(db, "update", payload)

            def delete(_s):
                return _Query(db, "delete")

        return _T()


@pytest.fixture
def client(monkeypatch):
    db = _FakeDB()

    def token_required(f):
        @wraps(f)
        def inner(*a, **k):
            return f(USER, *a, **k)
        return inner

    auth = types.ModuleType("services.auth")
    auth.token_required = token_required
    sb = types.ModuleType("services.supabase_client")
    sb.supabase = db
    monkeypatch.setitem(sys.modules, "services.auth", auth)
    monkeypatch.setitem(sys.modules, "services.supabase_client", sb)
    monkeypatch.delitem(sys.modules, "routes.vehicles", raising=False)

    from flask import Flask
    import routes.vehicles as vehicles

    app = Flask(__name__)
    app.register_blueprint(vehicles.vehicles_bp)
    c = app.test_client()
    c.db = db
    return c


def _new(**over):
    body = {"make": "Honda", "model": "Civic", "color": "Black",
            "license_plate": "abc1234", "plate_state": "fl"}
    body.update(over)
    return body


def test_create_stores_upper_cased_state(client):
    resp = client.post("/vehicles", json=_new())
    assert resp.status_code == 201
    verb, payload = client.db.calls[-1]
    assert verb == "insert"
    assert payload["plate_state"] == "FL"
    assert payload["license_plate"] == "ABC1234"


def test_create_without_state_is_rejected(client):
    resp = client.post("/vehicles", json=_new(plate_state=None))
    assert resp.status_code == 400
    assert "plate_state" in resp.get_json()["error"]
    assert client.db.calls == []


@pytest.mark.parametrize("bad", ["XX", "Florida", "F", ""])
def test_create_with_invalid_state_is_rejected(client, bad):
    resp = client.post("/vehicles", json=_new(plate_state=bad))
    assert resp.status_code == 400
    assert client.db.calls == []


def test_update_validates_state(client):
    resp = client.put(f"/vehicles/{VEHICLE}", json={"plate_state": "ZZ"})
    assert resp.status_code == 400
    assert client.db.calls == []


def test_update_without_state_leaves_it_out(client):
    resp = client.put(f"/vehicles/{VEHICLE}", json={"color": "Red"})
    assert resp.status_code == 200
    _verb, payload = client.db.calls[-1]
    assert payload == {"color": "Red"}


def test_update_blocked_by_booking_lock_is_409(client):
    client.db.raise_on_execute = _pg_error(LOCK_MSG, "23514")
    resp = client.put(f"/vehicles/{VEHICLE}", json={"license_plate": "NEW1"})
    assert resp.status_code == 409
    body = resp.get_json()
    assert body["code"] == "vehicle_in_active_booking"
    assert body["error"] == LOCK_MSG


def test_delete_blocked_by_booking_lock_is_409(client):
    client.db.raise_on_execute = _pg_error(LOCK_MSG, "23514")
    resp = client.delete(f"/vehicles/{VEHICLE}")
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "vehicle_in_active_booking"


def test_delete_during_checkout_hold_is_409(client):
    client.db.raise_on_execute = _pg_error(HOLD_MSG, "23514")
    resp = client.delete(f"/vehicles/{VEHICLE}")
    assert resp.status_code == 409
    assert resp.get_json()["error"] == HOLD_MSG


def test_plate_state_check_violation_is_not_a_lock(client):
    client.db.raise_on_execute = _pg_error(
        'new row for relation "vehicles" violates check constraint "vehicles_plate_state_check"', "23514")
    client.application.config["PROPAGATE_EXCEPTIONS"] = True
    with pytest.raises(APIError):
        client.put(f"/vehicles/{VEHICLE}", json={"color": "Red"})


def test_delete_with_history_before_fk_migration_is_409(client):
    client.db.raise_on_execute = _pg_error(
        'update or delete on table "vehicles" violates foreign key constraint '
        '"reservations_vehicle_id_fkey" on table "reservations"', "23503")
    resp = client.delete(f"/vehicles/{VEHICLE}")
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "vehicle_has_history"


def test_other_database_errors_still_raise(client):
    client.db.raise_on_execute = RuntimeError("connection reset")
    client.application.config["PROPAGATE_EXCEPTIONS"] = True
    with pytest.raises(RuntimeError):
        client.delete(f"/vehicles/{VEHICLE}")

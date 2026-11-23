#!/usr/bin/env python3
"""
Integration tests for Ticket #6: Reservation Sync & Conversation Creation.
Tests the endpoints against a live Flask backend.

These hit a real running server (BASE_URL below) rather than a fake/mock, so
a test here can only mean one of three things: the backend is unreachable
(SKIP, with a reason), the backend is reachable and behaves correctly (PASS),
or the backend is reachable and behaves incorrectly (FAIL). Earlier versions
of this file used `return True/False` instead of `assert`, which pytest
treats as a pass either way (only a PytestReturnNotNoneWarning is emitted) —
so all four tests here were vacuous and could never fail.
"""

import uuid
from datetime import datetime, timedelta

import pytest
import requests

BASE_URL = "http://localhost:5000/api"
REQUEST_TIMEOUT = 5


def _backend_reachable():
    """True only if something that looks like the SpotOn Flask API — not just
    "something" — is listening at BASE_URL.

    A plain TCP/HTTP success isn't enough: on macOS, ControlCenter's AirPlay
    Receiver listens on port 5000 by default and answers every request with
    an empty 403 (`Server: AirTunes/...`, zero-length body). `requests.get`
    treats that as a normal response, not a connection error — treating it as
    "reachable" would make every assertion below FAIL (not SKIP) on a stock
    Mac with no SpotOn backend running at all, which defeats the point of
    skipping. `GET /api/listings` (backend/routes/listings.py) always
    `jsonify`s its response, success or error, so requiring a parseable JSON
    body is a reliable signal this is actually our Flask app.
    """
    try:
        resp = requests.get(f"{BASE_URL}/listings", timeout=REQUEST_TIMEOUT)
    except requests.exceptions.RequestException:
        return False
    try:
        resp.json()
    except ValueError:
        return False
    return True


@pytest.fixture(scope="module")
def backend():
    """Skip this module's tests if no live backend is running at BASE_URL.

    An unreachable (or not-actually-our-API) backend means "no server to
    test against", not "the feature is broken" — so it must SKIP, not
    silently pass and not hard-fail the suite for someone without a local
    Flask server. It must never be turned into a `pass`/`except: return
    False` that reports green regardless.
    """
    if not _backend_reachable():
        pytest.skip(
            f"No SpotOn backend reachable at {BASE_URL} — start the Flask app "
            f"on localhost:5000 to run these integration tests. (If something "
            f"else answers on port 5000 — e.g. macOS AirPlay Receiver — this "
            f"will also skip, since that isn't the backend under test.)"
        )
    return BASE_URL


def test_listings_without_time_range(backend):
    """Backward-compatible listings endpoint (no time range) must return the
    full listing set as a 200 with a JSON list body."""
    resp = requests.get(f"{backend}/listings", timeout=REQUEST_TIMEOUT)

    assert resp.status_code == 200, (
        f"GET /api/listings expected 200, got {resp.status_code}: {resp.text}"
    )
    listings = resp.json()
    assert isinstance(listings, list), (
        f"expected /api/listings to return a JSON list, got {type(listings).__name__}"
    )


def test_listings_with_time_range(backend):
    """Listings endpoint with a start_time/end_time filter must still return
    200 with a JSON list (of listings available for that window)."""
    now = datetime.utcnow()
    start_time = (now + timedelta(days=1)).isoformat() + "Z"
    end_time = (now + timedelta(days=1, hours=2)).isoformat() + "Z"

    params = {"start_time": start_time, "end_time": end_time}
    resp = requests.get(f"{backend}/listings", params=params, timeout=REQUEST_TIMEOUT)

    assert resp.status_code == 200, (
        f"GET /api/listings?start_time={start_time}&end_time={end_time} "
        f"expected 200, got {resp.status_code}: {resp.text}"
    )
    listings = resp.json()
    assert isinstance(listings, list), (
        f"expected /api/listings (time-range filtered) to return a JSON list, "
        f"got {type(listings).__name__}"
    )


def test_create_reservation_route_is_retired(backend):
    """POST /api/reservations used to create an unpaid 'pending' booking that
    never expired (free calendar blocking). It is retired: it must answer 410
    Gone with a JSON explanation, and never create anything.

    The old overlap test here went through that route; the exclusion
    constraint is exercised by real bookings via finalize_paid_reservation
    (see supabase/tests/database/reservations_client_write_lockdown.test.sql).
    """
    payload = {
        "listing_id": str(uuid.uuid4()),
        "vehicle_id": str(uuid.uuid4()),
        "start_time": (datetime.utcnow() + timedelta(days=2)).isoformat() + "Z",
        "end_time": (datetime.utcnow() + timedelta(days=2, hours=2)).isoformat() + "Z",
    }

    resp = requests.post(f"{backend}/reservations", json=payload, timeout=REQUEST_TIMEOUT)

    assert resp.status_code == 410, (
        f"POST /api/reservations should be retired (410), got {resp.status_code}: {resp.text}"
    )
    assert "create-booking-payment" in resp.json()["error"]

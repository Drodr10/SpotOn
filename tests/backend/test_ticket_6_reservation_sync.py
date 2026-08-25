#!/usr/bin/env python3
"""
Integration tests for Ticket #6: Reservation Sync & Conversation Creation.
Tests the new endpoints and RPC functions against a live Flask backend.

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


def test_create_reservation_basic(backend):
    """Reservation creation endpoint must be reachable and return one of the
    documented outcomes for a payload with a random (non-existent) listing_id
    and renter_id: 201 if the DB somehow accepts it, 404/409 if it correctly
    rejects the unknown listing or an overlap, or 500 on a surfaced DB error.
    Anything else (e.g. a 4xx we don't expect, or a non-JSON body) is a real
    failure of the endpoint's contract.
    """
    payload = {
        "listing_id": str(uuid.uuid4()),
        "renter_id": str(uuid.uuid4()),
        "start_time": (datetime.utcnow() + timedelta(days=2)).isoformat() + "Z",
        "end_time": (datetime.utcnow() + timedelta(days=2, hours=2)).isoformat() + "Z",
        "total_price": 25.00,
    }

    resp = requests.post(f"{backend}/reservations", json=payload, timeout=REQUEST_TIMEOUT)

    assert resp.status_code in (201, 404, 409, 500), (
        f"POST /api/reservations with a random listing_id/renter_id returned "
        f"an unexpected status {resp.status_code} (expected 201/404/409/500): {resp.text}"
    )
    # The endpoint must always answer with a JSON body, even on error, so
    # callers (and this test) can inspect why.
    try:
        resp.json()
    except ValueError:
        pytest.fail(
            f"POST /api/reservations returned status {resp.status_code} with a "
            f"non-JSON body: {resp.text!r}"
        )


def test_overlap_detection(backend):
    """The Postgres exclusion constraint (reservations_no_overlap, requires
    btree_gist) must reject a second reservation that overlaps a first one on
    the same listing.

    This replaces the old version of the test, which never actually created a
    reservation and instead just printed a claim that the constraint exists.
    """
    listings_resp = requests.get(f"{backend}/listings", timeout=REQUEST_TIMEOUT)
    assert listings_resp.status_code == 200, (
        f"could not fetch listings to set up the overlap test: "
        f"{listings_resp.status_code}: {listings_resp.text}"
    )
    listings = listings_resp.json()
    if not listings:
        pytest.skip("backend has no listings to exercise overlap detection against")

    listing_id = listings[0]["id"]
    renter_id = str(uuid.uuid4())

    # Far-future window so this doesn't collide with unrelated real bookings.
    start = datetime.utcnow() + timedelta(days=365)
    end = start + timedelta(hours=2)
    # Second window starts inside the first and extends past it: a genuine overlap.
    overlap_start = start + timedelta(minutes=30)
    overlap_end = overlap_start + timedelta(hours=2)

    def _reservation_payload(s, e):
        return {
            "listing_id": listing_id,
            "renter_id": renter_id,
            "start_time": s.isoformat() + "Z",
            "end_time": e.isoformat() + "Z",
            "total_price": 25.00,
        }

    first = requests.post(
        f"{backend}/reservations",
        json=_reservation_payload(start, end),
        timeout=REQUEST_TIMEOUT,
    )
    if first.status_code != 201:
        # Can't establish the baseline booking (e.g. renter_id/listing FK
        # constraints need real seed data we don't have here) — skip rather
        # than fail, since we haven't yet exercised the invariant we're
        # actually testing.
        pytest.skip(
            f"could not create the baseline reservation needed to test overlap "
            f"detection (status {first.status_code}: {first.text})"
        )

    second = requests.post(
        f"{backend}/reservations",
        json=_reservation_payload(overlap_start, overlap_end),
        timeout=REQUEST_TIMEOUT,
    )

    assert second.status_code in (409, 400), (
        f"a reservation overlapping an existing one on the same listing "
        f"({listing_id}) should have been rejected (409/400) by the "
        f"reservations_no_overlap exclusion constraint, but got "
        f"{second.status_code}: {second.text}"
    )

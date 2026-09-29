"""Webhook envelope tests for Stripe snapshot events and v2 thin pings."""
import hashlib
import hmac
import json
import sys
import time
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

WEBHOOK_SECRET = "whsec_format_test"
API_KEY = "sk_test_format_test"


@pytest.fixture
def app_ctx():
    from flask import Flask

    app = Flask(__name__)
    with app.app_context():
        yield app


@pytest.fixture
def stripe_client(monkeypatch):
    for name, attrs in {
        "services.supabase_client": {"supabase": types.SimpleNamespace()},
        "services.payouts": {
            "_parse_ts": lambda *_a: None,
            "release_pending_for_account": lambda *_a: 0,
        },
        "services.notifications": {"send_booking_notifications": lambda *_a: {}},
    }.items():
        module = types.ModuleType(name)
        for attr, value in attrs.items():
            setattr(module, attr, value)
        monkeypatch.setitem(sys.modules, name, module)

    monkeypatch.delitem(sys.modules, "services.stripe_client", raising=False)
    import services.stripe_client as sc

    monkeypatch.setattr(sc, "webhookSecret", WEBHOOK_SECRET)
    monkeypatch.setattr(sc, "secretKey", API_KEY)
    return sc


def _signed(payload: dict) -> tuple[bytes, str]:
    body = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = int(time.time())
    signature = hmac.new(
        WEBHOOK_SECRET.encode(),
        f"{timestamp}.".encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return body, f"t={timestamp},v1={signature}"


def test_accepts_verified_v2_event_destination_ping(stripe_client, app_ctx):
    body, signature = _signed({
        "id": "evt_test_ping",
        "object": "v2.core.event",
        "type": "v2.core.event_destination.ping",
        "livemode": False,
        "created": "2026-09-18T19:56:56.947Z",
        "related_object": {
            "id": "ed_test_ping",
            "type": "v2.core.event_destination",
            "url": "/v2/core/event_destinations/ed_test_ping",
        },
        "reason": None,
    })

    response, status = stripe_client.handle_webhook(body, signature)

    assert status == 200
    assert response.get_json() == {"received": True}


def test_keeps_processing_v1_snapshot_events(stripe_client, monkeypatch, app_ctx):
    payment_intent = {"id": "pi_snapshot_test", "object": "payment_intent"}
    body, signature = _signed({
        "id": "evt_snapshot_test",
        "object": "event",
        "type": "payment_intent.succeeded",
        "data": {"object": payment_intent},
    })
    handled = []
    monkeypatch.setattr(stripe_client, "_on_payment_succeeded", handled.append)

    response, status = stripe_client.handle_webhook(body, signature)

    assert status == 200
    assert response.get_json() == {"received": True}
    assert handled[0]["id"] == "pi_snapshot_test"


def test_rejects_unhandled_thin_business_event(stripe_client, app_ctx):
    body, signature = _signed({
        "id": "evt_test_unknown",
        "object": "v2.core.event",
        "type": "v1.payment_intent.succeeded",
        "created": "2026-09-18T19:56:56.947Z",
        "context": None,
        "livemode": False,
        "reason": None,
        "related_object": {
            "id": "pi_thin_test",
            "type": "payment_intent",
            "url": "/v1/payment_intents/pi_thin_test",
        },
    })

    response, status = stripe_client.handle_webhook(body, signature)

    assert status == 400
    assert "Configure this Stripe destination to send snapshot events" in response.get_json()["error"]


def test_rejects_a_thin_ping_with_an_invalid_signature(stripe_client, app_ctx):
    body, _ = _signed({
        "id": "evt_test_ping",
        "object": "v2.core.event",
        "type": "v2.core.event_destination.ping",
        "related_object": {
            "id": "ed_test_ping",
            "type": "v2.core.event_destination",
            "url": "/v2/core/event_destinations/ed_test_ping",
        },
    })

    response, status = stripe_client.handle_webhook(body, "t=1,v1=invalid")

    assert status == 400
    assert response.get_json()["error"].startswith("Webhook verification failed:")

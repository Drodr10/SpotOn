"""The Connect callback must follow the API host, even behind a TLS proxy."""

import sys
import types
from pathlib import Path

from flask import Blueprint, Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))


def test_account_link_returns_to_current_api_host(monkeypatch):
    for name, attrs in {
        "services.supabase_client": {"supabase": types.SimpleNamespace()},
        "services.payouts": {
            "_parse_ts": lambda *_a: None,
            "release_pending_for_account": lambda *_a: 0,
        },
        "services.notifications": {"send_booking_notifications": lambda *_a: {}},
    }.items():
        module = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        monkeypatch.setitem(sys.modules, name, module)

    monkeypatch.delitem(sys.modules, "services.stripe_client", raising=False)
    from services import stripe_client

    class ProfileQuery:
        def select(self, *_a):
            return self

        def eq(self, *_a):
            return self

        def single(self):
            return self

        def execute(self):
            return types.SimpleNamespace(data={"stripe_account_id": "acct_test"})

    monkeypatch.setattr(
        stripe_client, "supabase",
        types.SimpleNamespace(table=lambda *_a: ProfileQuery()),
    )
    captured = {}

    def create_link(**kwargs):
        captured.update(kwargs)
        return types.SimpleNamespace(url="https://connect.stripe.com/test")

    monkeypatch.setattr(
        stripe_client, "stripe",
        types.SimpleNamespace(AccountLink=types.SimpleNamespace(create=create_link)),
    )
    monkeypatch.setenv("BACKEND_URL", "retired.ngrok-free.app")

    app = Flask(__name__)
    blueprint = Blueprint("stripe", __name__)
    blueprint.add_url_rule("/stripe/onboarding-complete", endpoint="onboarding_return", view_func=lambda: "")
    blueprint.add_url_rule("/stripe/onboarding-expired", endpoint="onboarding_expired", view_func=lambda: "")
    app.register_blueprint(blueprint, url_prefix="/api")

    # A TLS terminating proxy can present HTTP to Flask internally.
    with app.test_request_context("/api/stripe/create-account-link", base_url="http://spoton-gjw6.onrender.com"):
        response = stripe_client.createAccountLink("seller-123")

    assert response.get_json()["account_link_url"] == "https://connect.stripe.com/test"
    assert captured["return_url"] == (
        "https://spoton-gjw6.onrender.com/api/stripe/onboarding-complete?user_id=seller-123"
    )
    assert captured["refresh_url"] == "https://spoton-gjw6.onrender.com/api/stripe/onboarding-expired"

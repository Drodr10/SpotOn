"""Tests for the charge.refunded webhook handler (services.stripe_client._on_charge_refunded).

Before this handler existed, a refund issued manually from the Stripe
dashboard -- the ONLY way a booking gets refunded on request, since there is
no in-app cancellation flow independent of this fix -- was received and
logged but never applied. The reservation row kept saying payout_status
'held'/'payout_ready' after the money was already back with the renter, so
the payout sweep would go on to Transfer the host their cut of a booking that
had already been refunded out from under it.

WHAT THESE PIN
  * a full refund on a 'held'/'payout_ready' reservation flips it to
    refunded/cancelled -- which is what pulls it out of every sweep query
  * a refund landing AFTER the host was already paid out ('paid_out') is NOT
    silently relabeled 'refunded' -- that would misrepresent that the payout
    never happened. It gets a distinct 'refunded_after_payout' status instead.
  * redelivery is a no-op: a reservation already 'refunded' or
    'refunded_after_payout' is left alone, since webhooks can and do redeliver
  * a partial refund does not touch payout_status at all -- there is no
    partial-refund policy to encode, so this only makes it visible
  * a charge with no matching reservation (the stranded-payment conflict
    refund case) does not crash -- there being nothing to reconcile is
    EXPECTED, not an error

WHAT THESE DO NOT COVER
  A real Stripe webhook payload's full shape -- only the fields the handler
  actually reads (payment_intent, amount, amount_refunded, refunded, id).
"""
import sys
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

RES_ID = "r-refund-webhook-1"
PI = "pi_webhook_test"


class _Query:
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


@pytest.fixture
def stripe_client(monkeypatch):
    """Import services.stripe_client with its heavy deps stubbed out, as the
    sibling test_stranded_payment_refund.py does."""
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


def _res(**over):
    row = {"id": RES_ID, "payout_status": "held", "stripe_transfer_id": None,
           "stripe_payment_intent": PI}
    row.update(over)
    return row


def _charge(**over):
    charge = {"id": "ch_test", "payment_intent": PI, "amount": 1000,
              "amount_refunded": 1000, "refunded": True}
    charge.update(over)
    return charge


# ── no reservation to reconcile ──────────────────────────────────────────────

def test_missing_payment_intent_is_skipped_not_crashed(stripe_client, monkeypatch):
    db = _FakeDB({"reservations": []})
    monkeypatch.setattr(stripe_client, "supabase", db)

    stripe_client._on_charge_refunded(_charge(payment_intent=None))

    assert db.calls == []


def test_no_matching_reservation_is_expected_not_an_error(stripe_client, monkeypatch):
    """The stranded-payment conflict-refund case: that PI was refunded
    specifically because no reservation was ever created for it."""
    db = _FakeDB({"reservations": []})
    monkeypatch.setattr(stripe_client, "supabase", db)

    stripe_client._on_charge_refunded(_charge())  # must not raise

    assert db.rows["reservations"] == []


# ── partial refunds are visible, not acted on ────────────────────────────────

def test_a_partial_refund_does_not_change_payout_status(stripe_client, monkeypatch):
    db = _FakeDB({"reservations": [_res(payout_status="held")]})
    monkeypatch.setattr(stripe_client, "supabase", db)

    stripe_client._on_charge_refunded(_charge(amount=1000, amount_refunded=400, refunded=False))

    assert db.rows["reservations"][0]["payout_status"] == "held"


# ── the happy path: still owed, now refunded ─────────────────────────────────

def test_a_full_refund_on_a_held_reservation_marks_it_refunded(stripe_client, monkeypatch):
    db = _FakeDB({"reservations": [_res(payout_status="held")]})
    monkeypatch.setattr(stripe_client, "supabase", db)

    stripe_client._on_charge_refunded(_charge())

    row = db.rows["reservations"][0]
    assert row["payout_status"] == "refunded"
    assert row["status"] == "cancelled"


def test_a_full_refund_on_a_payout_ready_reservation_marks_it_refunded(stripe_client, monkeypatch):
    db = _FakeDB({"reservations": [_res(payout_status="payout_ready")]})
    monkeypatch.setattr(stripe_client, "supabase", db)

    stripe_client._on_charge_refunded(_charge())

    assert db.rows["reservations"][0]["payout_status"] == "refunded"


# ── the case that must NOT be silently relabeled ─────────────────────────────

def test_a_refund_after_payout_is_flagged_not_relabeled_refunded(stripe_client, monkeypatch):
    """The host was already paid before this refund landed. Marking this
    plain 'refunded' would claim the payout never happened when it did --
    real money is gone, and only a human clawing back the transfer fixes it."""
    db = _FakeDB({"reservations": [_res(payout_status="paid_out", stripe_transfer_id="tr_1")]})
    monkeypatch.setattr(stripe_client, "supabase", db)

    stripe_client._on_charge_refunded(_charge())

    assert db.rows["reservations"][0]["payout_status"] == "refunded_after_payout"


# ── redelivery is a no-op ────────────────────────────────────────────────────

@pytest.mark.parametrize("already", ["refunded", "refunded_after_payout"])
def test_redelivery_of_an_already_handled_refund_is_a_no_op(stripe_client, monkeypatch, already):
    db = _FakeDB({"reservations": [_res(payout_status=already)]})
    monkeypatch.setattr(stripe_client, "supabase", db)

    stripe_client._on_charge_refunded(_charge())

    assert db.rows["reservations"][0]["payout_status"] == already
    assert not any(call[1] == "update" for call in db.calls), "must not write on redelivery"

"""Tests for in-app account deletion (App Store Guideline 5.1.1(v)).

Tested at the service layer with the Supabase client faked, for the same reason
as the notification tests: the alternative needs a real project and a device.

WHAT THESE PIN
  * deletion is REFUSED while the user still has obligations — an unfinished
    booking as renter, upcoming bookings at their spot as host, or earnings that
    have not been paid out. Each refusal explains itself.
  * the happy path anonymises rather than deletes: reservations, conversations
    and messages survive untouched, because they are the counterparty's records
    too and the financial ones must outlive the account.
  * licence plates go before the profile scrub, so a failure halfway through
    cannot leave the most sensitive data behind.
  * listings are DEACTIVATED, never deleted — reservations reference them.
  * the auth user is SOFT-deleted. A hard delete is rejected by
    profiles.id -> auth.users(id), and soft delete is what actually stops
    sign-in while keeping that foreign key satisfiable.

WHAT THESE DO NOT COVER
  Storage removal is asserted only as "asked for these paths". Whether the
  bucket really drops them needs a live project.
"""
import sys
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

USER = "22222222-2222-4222-8222-222222222222"
OTHER = "33333333-3333-4333-8333-333333333333"


class _Query:
    """Chainable stand-in for the PostgREST query builder."""

    def __init__(self, db, table, verb, payload=None):
        self.db, self.table, self.verb, self.payload = db, table, verb, payload
        self.filters = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def gt(self, col, val):
        self.filters[f"{col}__gt"] = val
        return self

    def in_(self, col, vals):
        self.filters[f"{col}__in"] = list(vals)
        return self

    def _matches(self, row):
        """Apply the recorded filters, so a wrong query fails the test."""
        for key, want in self.filters.items():
            if key.endswith("__gt"):
                col = key[:-4]
                if not (col in row and str(row[col]) > str(want)):
                    return False
            elif key.endswith("__in"):
                col = key[:-4]
                if row.get(col) not in want:
                    return False
            else:
                if row.get(key) != want:
                    return False
        return True

    def execute(self):
        self.db.calls.append((self.table, self.verb, dict(self.filters), self.payload))
        rows = [r for r in self.db.rows.get(self.table, []) if self._matches(r)]
        if self.verb in ("select", "delete"):
            return type("R", (), {"data": rows})()
        return type("R", (), {"data": []})()


class _Bucket:
    def __init__(self, db):
        self.db = db

    def list(self, path):
        return self.db.avatar_files

    def remove(self, paths):
        self.db.removed_paths.extend(paths)


class _Storage:
    def __init__(self, db):
        self.db = db

    def from_(self, _bucket):
        return _Bucket(self.db)


class _Admin:
    def __init__(self, db):
        self.db = db

    def delete_user(self, uid, should_soft_delete=False):
        self.db.auth_deleted = (uid, should_soft_delete)


class _FakeDB:
    def __init__(self, rows=None, avatar_files=None):
        self.rows = rows or {}
        self.calls = []
        self.avatar_files = avatar_files or []
        self.removed_paths = []
        self.auth_deleted = None
        self.storage = _Storage(self)
        self.auth = type("A", (), {"admin": _Admin(self)})()

    def table(self, name):
        return _Query(self, name, "select")

    # verb-specific entry points
    def _verb(self, name, verb, payload=None):
        return _Query(self, name, verb, payload)


def _install(monkeypatch, db):
    # services/supabase_client.py calls create_client() at MODULE level, so
    # importing account_deletion for real needs SUPABASE_URL/KEY in the
    # environment. CI gives those to the import-check step but deliberately not
    # to the test step, so a bare import here passes locally (where .env exists)
    # and fails in CI with "supabase_url is required".
    #
    # Stub the module before importing, as the sibling tests do. Nothing is
    # lost: _Router below replaces the client anyway, so the real one was only
    # ever built to be thrown away.
    stub = types.ModuleType("services.supabase_client")
    stub.supabase = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "services.supabase_client", stub)
    # Force a fresh import so the stub is what gets bound, even if an earlier
    # test in the same session already imported the real thing.
    monkeypatch.delitem(sys.modules, "services.account_deletion", raising=False)

    import services.account_deletion as mod

    class _Router:
        def __init__(self, db):
            self.db = db
            self.storage = db.storage
            self.auth = db.auth

        def table(self, name):
            outer = self.db

            class _T:
                def select(_s, *a, **k):
                    return _Query(outer, name, "select")

                def delete(_s):
                    return _Query(outer, name, "delete")

                def update(_s, payload):
                    return _Query(outer, name, "update", payload)

            return _T()

    monkeypatch.setattr(mod, "supabase", _Router(db))
    return mod


FUTURE = "2099-01-01T00:00:00+00:00"
PAST = "2020-01-01T00:00:00+00:00"


def _res(**over):
    row = {
        "id": "r1",
        "renter_id": USER,
        "listing_id": "L1",
        "status": "confirmed",
        "end_time": FUTURE,
        "payout_status": "paid",
    }
    row.update(over)
    return row


def _rows_for(**tables):
    base = {"listings": [], "reservations": [], "vehicles": [], "reservation_holds": []}
    base.update(tables)
    return base


# ── refusals ────────────────────────────────────────────────────────────────

def test_refused_while_the_user_has_an_unfinished_booking(monkeypatch):
    db = _FakeDB(_rows_for(reservations=[_res()]))
    mod = _install(monkeypatch, db)

    out = mod.delete_account(USER)

    assert "blockers" in out
    assert "haven't finished" in out["blockers"][0]
    assert db.auth_deleted is None, "must not disable the account when refusing"


def test_a_finished_booking_does_not_block(monkeypatch):
    """The discriminator: only bookings that have not ended yet count."""
    db = _FakeDB(_rows_for(reservations=[_res(end_time=PAST)]))
    mod = _install(monkeypatch, db)

    assert mod.deletion_blockers(USER) == []


def test_a_cancelled_booking_does_not_block(monkeypatch):
    db = _FakeDB(_rows_for(reservations=[_res(status="cancelled")]))
    mod = _install(monkeypatch, db)

    assert mod.deletion_blockers(USER) == []


def test_someone_elses_booking_does_not_block(monkeypatch):
    db = _FakeDB(_rows_for(reservations=[_res(renter_id=OTHER, listing_id="ZZ")]))
    mod = _install(monkeypatch, db)

    assert mod.deletion_blockers(USER) == []


def test_refused_while_renters_have_upcoming_bookings_at_the_users_spot(monkeypatch):
    db = _FakeDB(_rows_for(
        listings=[{"id": "L1", "owner_id": USER}],
        reservations=[_res(renter_id=OTHER)],
    ))
    mod = _install(monkeypatch, db)

    out = mod.delete_account(USER)

    assert any("without parking" in b for b in out["blockers"])


def test_refused_while_earnings_are_unpaid(monkeypatch):
    """Money owed is its own blocker, separate from an unfinished stay."""
    db = _FakeDB(_rows_for(
        listings=[{"id": "L1", "owner_id": USER}],
        reservations=[_res(renter_id=OTHER, end_time=PAST, payout_status="held")],
    ))
    mod = _install(monkeypatch, db)

    reasons = mod.deletion_blockers(USER)

    assert any("paid out" in r for r in reasons)
    assert not any("without parking" in r for r in reasons), "the stay has ended"


def test_a_settled_payout_does_not_block(monkeypatch):
    db = _FakeDB(_rows_for(
        listings=[{"id": "L1", "owner_id": USER}],
        reservations=[_res(renter_id=OTHER, end_time=PAST, payout_status="paid")],
    ))
    mod = _install(monkeypatch, db)

    assert mod.deletion_blockers(USER) == []


def test_a_refusal_explains_itself(monkeypatch):
    db = _FakeDB(_rows_for(reservations=[_res()]))
    mod = _install(monkeypatch, db)

    for reason in mod.deletion_blockers(USER):
        assert len(reason) > 30 and reason.endswith("."), f"unhelpful blocker: {reason!r}"


# ── the happy path ──────────────────────────────────────────────────────────

def test_clean_account_is_anonymised_not_deleted(monkeypatch):
    db = _FakeDB(_rows_for(), avatar_files=[{"name": "me.jpg"}])
    mod = _install(monkeypatch, db)

    out = mod.delete_account(USER)
    assert out["deleted"] is True

    updates = [c for c in db.calls if c[0] == "profiles" and c[1] == "update"]
    assert len(updates) == 1
    scrub = updates[0][3]
    assert scrub["full_name"] == "Deleted user"
    assert scrub["avatar_url"] is None
    assert scrub["expo_push_token"] is None
    assert USER in scrub["email"] and scrub["email"].endswith("@spoton.invalid")

    touched = {c[0] for c in db.calls}
    for survives in ("reservations", "conversations", "messages"):
        assert not any(
            c[0] == survives and c[1] in ("delete", "update") for c in db.calls
        ), f"{survives} must survive deletion — it is the counterparty's record too"
    assert "profiles" in touched


def test_licence_plates_go_before_the_profile_is_scrubbed(monkeypatch):
    """Ordering is the point: a failure partway must not leave plates behind."""
    db = _FakeDB(_rows_for(vehicles=[{"id": "v1", "owner_user_id": USER}]))
    mod = _install(monkeypatch, db)

    mod.delete_account(USER)

    order = [(c[0], c[1]) for c in db.calls]
    assert ("vehicles", "delete") in order
    assert order.index(("vehicles", "delete")) < order.index(("profiles", "update"))


def test_listings_are_deactivated_never_deleted(monkeypatch):
    db = _FakeDB(_rows_for(listings=[{"id": "L1", "owner_id": USER},
                                     {"id": "L2", "owner_id": USER}]))
    mod = _install(monkeypatch, db)

    out = mod.delete_account(USER)

    assert out["listings_deactivated"] == 2
    assert not any(c[0] == "listings" and c[1] == "delete" for c in db.calls)
    upd = [c for c in db.calls if c[0] == "listings" and c[1] == "update"][0]
    assert upd[3] == {"is_active": False}


def test_auth_user_is_soft_deleted_so_the_profiles_fk_still_resolves(monkeypatch):
    db = _FakeDB(_rows_for())
    mod = _install(monkeypatch, db)

    mod.delete_account(USER)

    assert db.auth_deleted == (USER, True), "hard delete is rejected by profiles.id -> auth.users(id)"


def test_avatar_files_are_removed_from_their_own_folder(monkeypatch):
    db = _FakeDB(_rows_for(), avatar_files=[{"name": "a.jpg"}, {"name": "b.jpg"}])
    mod = _install(monkeypatch, db)

    out = mod.delete_account(USER)

    assert out["avatars_removed"] == 2
    assert db.removed_paths == [f"{USER}/a.jpg", f"{USER}/b.jpg"]


def test_a_stuck_avatar_file_does_not_strand_the_deletion(monkeypatch):
    """Storage is best-effort: the account must still become unusable."""
    db = _FakeDB(_rows_for())
    mod = _install(monkeypatch, db)

    def _boom(_bucket):
        raise RuntimeError("storage unreachable")

    monkeypatch.setattr(mod.supabase.storage, "from_", _boom)

    out = mod.delete_account(USER)

    assert out["deleted"] is True
    assert db.auth_deleted == (USER, True)

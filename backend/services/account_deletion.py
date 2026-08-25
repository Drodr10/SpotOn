"""Account deletion.

Apple's App Store Guideline 5.1.1(v) requires that an app which lets users
create an account also lets them delete it from inside the app.

A literal `DELETE FROM profiles` is not available here, and would be the wrong
thing if it were. `reservations.renter_id`, `messages.sender_id` and
`conversations.renter_id/owner_id` all reference `profiles(id)` with no
ON DELETE clause, so the delete simply fails for anyone who has ever booked or
hosted. Forcing it through would take the counterparty's copy of every booking
and conversation with it, along with financial records that Stripe disputes
(months) and tax retention (years) require us to keep.

So deletion here means: remove the personal data, keep the transactional record,
and make the account unusable.

  removed      vehicles (licence plates), checkout holds, avatar files, and the
               name / email / avatar / push token on the profile
  kept         reservations, conversations and messages — the other party's
               records too — plus the Stripe identifiers that make a past
               payment auditable
  deactivated  listings, so nothing new can be booked. They are not deleted,
               because reservations reference them.
  disabled     the auth user is SOFT-deleted, which blocks sign-in while leaving
               the row intact for the profiles FK to point at

Deletion is refused while the user still has obligations — a live booking or
money owed. Apple permits requiring a user to settle those first; silently
cancelling a renter's paid parking, or abandoning a host's unpaid earnings,
would be worse than asking them to wait.
"""

from datetime import datetime, timezone

from services.supabase_client import supabase

# Payout states that mean money is still owed to the host.
UNSETTLED_PAYOUT_STATES = ("held", "payout_ready")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _own_listing_ids(user_id: str) -> list[str]:
    rows = (
        supabase.table("listings").select("id").eq("owner_id", user_id).execute().data
    ) or []
    return [r["id"] for r in rows]


def deletion_blockers(user_id: str) -> list[str]:
    """Reasons this account cannot be deleted yet, phrased for the person reading them."""
    blockers: list[str] = []
    now = _now_iso()

    renting = (
        supabase.table("reservations")
        .select("id")
        .eq("renter_id", user_id)
        .eq("status", "confirmed")
        .gt("end_time", now)
        .execute()
        .data
    ) or []
    if renting:
        blockers.append(
            f"You have {len(renting)} booking(s) that haven't finished yet. "
            "You can delete your account once they end, or cancel them first."
        )

    listing_ids = _own_listing_ids(user_id)
    if listing_ids:
        hosting = (
            supabase.table("reservations")
            .select("id")
            .in_("listing_id", listing_ids)
            .eq("status", "confirmed")
            .gt("end_time", now)
            .execute()
            .data
        ) or []
        if hosting:
            blockers.append(
                f"{len(hosting)} renter(s) have upcoming bookings at your spot(s). "
                "Deleting now would leave them without parking."
            )

        owed = (
            supabase.table("reservations")
            .select("id")
            .in_("listing_id", listing_ids)
            .in_("payout_status", list(UNSETTLED_PAYOUT_STATES))
            .execute()
            .data
        ) or []
        if owed:
            blockers.append(
                f"You have earnings from {len(owed)} booking(s) that haven't been paid out yet. "
                "Deleting now would forfeit them."
            )

    return blockers


def _delete_avatar_files(user_id: str) -> int:
    """Avatars live under <user_id>/ — see the upload policy in 20260603002952."""
    try:
        files = supabase.storage.from_("avatars").list(user_id) or []
        paths = [f"{user_id}/{f['name']}" for f in files if f.get("name")]
        if paths:
            supabase.storage.from_("avatars").remove(paths)
        return len(paths)
    except Exception as err:  # noqa: BLE001 — a stuck file must not strand the deletion
        print(f"[account] avatar cleanup failed for {user_id}: {err}")
        return 0


def delete_account(user_id: str) -> dict:
    """Anonymise the account. Returns a summary, or {'blockers': [...]} if refused."""
    blockers = deletion_blockers(user_id)
    if blockers:
        return {"blockers": blockers}

    summary = {"listings_deactivated": 0, "vehicles_removed": 0, "avatars_removed": 0}

    # Licence plates are the most sensitive thing we hold; they go first so a
    # later failure cannot leave them behind.
    removed = (
        supabase.table("vehicles").delete().eq("owner_user_id", user_id).execute().data
    ) or []
    summary["vehicles_removed"] = len(removed)

    supabase.table("reservation_holds").delete().eq("renter_id", user_id).execute()

    listing_ids = _own_listing_ids(user_id)
    if listing_ids:
        supabase.table("listings").update({"is_active": False}).eq(
            "owner_id", user_id
        ).execute()
        summary["listings_deactivated"] = len(listing_ids)

    summary["avatars_removed"] = _delete_avatar_files(user_id)

    # Tombstone rather than NULL: email is how a returning user would be
    # recognised, and a unique constraint would reject a second NULL-free blank.
    supabase.table("profiles").update(
        {
            "full_name": "Deleted user",
            "email": f"deleted+{user_id}@spoton.invalid",
            "avatar_url": None,
            "expo_push_token": None,
        }
    ).eq("id", user_id).execute()

    # Soft delete: blocks sign-in, keeps the row so profiles.id still resolves.
    # A hard delete is rejected by that foreign key.
    supabase.auth.admin.delete_user(user_id, should_soft_delete=True)

    return {"deleted": True, **summary}

# What changed since 2026-08-09

Checked 2026-08-25. Companion to `qa-triage-2026-08-09.md`, which is still
accurate except where noted. Local clone had not fetched since Aug 9.

---

## 1. RESOLVED 2026-08-25 — bookings were charged against a rule set nothing checked

> **Fixed.** `20260730005125` was applied to the hosted database on 2026-08-25.
> Verified read-only afterwards: `reservation_validation_error` answers on the
> 3-arg signature, and `end_time must be after start_time` short-circuits before
> the listing lookup — which only the new body does. End to end, on a real
> hourly-only listing ($3/hr, no daily/weekly/monthly), bookings of 2h, 10h and
> 8 days all now return ALLOWED. The 10h case is precisely the one that used to
> be charged and then refused.
>
> The section below is kept as the record of what was wrong and why.

### The original finding

Two migrations are merged into `main` but **not applied to the hosted DB**.
Both probed directly, not inferred.

| Migration | In `main`? | Live? |
|---|---|---|
| `20260720120000_add_notification_events` | yes (since Jul) | ~~NO~~ **applied 2026-08-25** |
| `20260730005125_align_reservation_rate_validation` | merged via #65 | ~~NO~~ **applied 2026-08-25** |

**As of 2026-08-25 every migration in `supabase/migrations/` is live on the
hosted database except `20260808120000` (PR #66, a no-op — RLS is already on)
and `20260808140000` (PR #70, not yet merged).** Re-probed after applying:
`notification_events`, `reservation_holds`, `get_visible_listings`,
`listings.available_from/until`, `reservations.payout_status` and the three
`profiles` columns all report PRESENT.

`reservation_validation_error` does not exist live in *any* signature — both
the 3-arg and 1-arg forms return `PGRST202 ... no matches found`.

### What that actually produces in production right now

`0730` was meant to do two things at once: install a shared rule, and *loosen*
it. What is live instead is the **May trigger, unloosened, with no pre-charge
check in front of it**:

- **Pre-charge check — gone.** `_reservation_validation_error()`
  (`stripe_client.py:58`, called at `:219`) fails open by deliberate design:
  a missing RPC is caught, logged as `pre-charge validation unavailable`, and
  returns `None`, so the card is charged. Failing open is correct *given a live
  backstop* — and there is one, just not the intended one.
- **Backstop — live, and stricter than the code expects.**
  `trg_validate_reservation_rate` from `20260513120000_add_temporal_pricing`
  is still installed, still `BEFORE INSERT OR UPDATE ON reservations`, and
  still demands **the rate tier matching the duration**:

  | duration | trigger requires |
  |---|---|
  | ≥ 4 weeks | `monthly_rate` |
  | ≥ 7 days | `weekly_rate` |
  | ≥ 9 hours | `daily_rate` |
  | otherwise | `hourly_rate` |

  `0730` replaces this with "any rate exists is enough". That replacement is
  not applied.

So the sequence today is: **charge → trigger raises `P0001` → refund.**
`finalize_paid_reservation`'s `WHEN OTHERS` returns
`('db_' || SQLSTATE || ': ' || SQLERRM)`, `_is_terminal_finalize_error` matches
`^db_(P0001|23[0-9A-Z]{3}):`, and `_refund_stranded_payment` reverses it. The
renter is not left permanently out of pocket — that part of #63 is pure Python
and is live — but **the booking fails**, after a real charge and refund.

### How reachable is it

Very. `CreateListing2.tsx:112-124` writes `weekly_rate: null, monthly_rate: null`
for every hourly-mode listing, and `daily_rate` only if the lister opted in. So
an hourly listing with no daily rate rejects **any booking of 9 hours or more** —
and Current mode's own cap is `HARD_CAP_HOURS = 96`. A 10-hour booking on a
typical hourly listing is charged and then refused.

This is exactly the class of bug #63 was written to prevent, and exactly what
open PR #67 (`fix/rate-tier-by-duration`, B4) addresses in the app layer.

**Fix is one hand-applied migration, not a code change.**

### Why CI is green anyway

Every test in `test_stranded_payment_refund.py` stubs `supabase.rpc`, so nothing
reaches a real database. `test_pre_charge_check_fails_open_when_unreachable`
asserts the fail-open behaviour explicitly — which confirms the reading above
rather than contradicting it. Green CI here means "the Python is correct given
the migrations are applied." They are not.

---

## 2. That commit message is a caveat, not a diagnosis

Read in full, `734840d` (Adrian, Jul 30 23:09) is:

> Added jwt authentication to backend endpoints, updated frontend stripe
> requests to support new endpoint Authorization Header. **Cant finalize
> bookings due to exisitng notification error.**

"exisitng" — pre-existing. The sentence is a note about what the author was
**unable to test**, not a claim that notifications cause finalize to fail. My
earlier reading of it as a misdiagnosis was wrong.

That reframing is load-bearing, because it explains a gap in the diff (§3).

**The technical point still stands, and now supports the caveat rather than
contradicting it:** a missing `notification_events` genuinely cannot fail a
booking. The migration creates a table, two indexes, and RLS — no triggers, no
functions. `send_booking_notifications` is wrapped in `try/except` at
`stripe_client.py:498`, and that guard already existed at `734840d` (checked
against the blob at that commit). `_insert_event` swallows everything and
returns `False`. `run_notification_sweep` only SELECTs `reservations` and sits
behind the `SWEEP_SECRET` route. On the frontend, `expo-notifications` appears
only in `utils/push.ts`, which the booking path never calls. So the visible
symptom would have been the `[notifications] event insert failed ...` line in
the backend log during a booking that failed for a *different* reason — which
is exactly what a "can't finalize, and there's a notification error in the log"
note looks like from the inside.

### What was almost certainly blocking them

The timing is hard to ignore:

| when | what |
|---|---|
| Jul 29, 21:14 | `f554281` — *"never charge for a booking the database will refuse"*, adding migration `0730` |
| Jul 30, 23:09 | `734840d` — *"Cant finalize bookings…"* |

Those are ~26 hours apart, and `endpoint-auth` did not contain `f554281` —
that fix only reached `main` on Aug 25 via #63. So Adrian was working on a tree
with **no pre-charge check and the strict May trigger live**: precisely the §1
failure, and precisely the bug documented the previous evening. A booking whose
duration had no matching rate tier would charge, then fail at insert, with no
refund path yet either.

Still worth ruling out **#68** (still open): `main` requests the *web*
`payment_element` for the mobile PaymentSheet
(`stripe_client.py:39-43`), which surfaces only as a generic `Failed`. That is
independently wrong. Check the device log for `mc_elements_session_load_failed`.

---

## 3. What actually merged (all on Aug 25, hours ago — not weeks)

| PR | Branch | Note |
|---|---|---|
| #62, #73 | `chore/declare-python-version` | merged twice, ~13h apart |
| #63 | `ci/automated-checks` | CI + the pre-charge fix (inert, see §1) |
| #65 | `endpoint-auth` | JWT auth on backend endpoints; brought `0730` in |

CI is now green on `main` and running on every push.

### #65 left the two money-path routes ungated

This is the gap the §2 caveat explains: you cannot gate what you cannot test.
In `backend/routes/stripe.py` on `main`:

| route | `@token_required`? |
|---|---|
| `/stripe/create-booking-payment` | yes |
| `/stripe/create-connect-account` | yes |
| `/stripe/create-account-link` | yes |
| `/stripe/sync-account` | yes |
| **`/stripe/finalize-booking`** | **no** |
| **`/stripe/release-hold`** | **no** |

Both take an opaque id straight from the request body with no caller identity
and no ownership check:

```python
def release_hold_route():
    return release_booking_hold(request.json.get("hold_id"))

def finalize_booking_route():
    return finalize_booking(request.json.get("payment_intent_id"))
```

Severity differs. `finalize-booking` is the milder one: it re-fetches the
PaymentIntent from Stripe, refuses anything not `succeeded`, and builds the
reservation from PI metadata — so it cannot be used to conjure a booking, only
to drive writes and Stripe calls with a known PI id. `release-hold` is the
sharper edge: a `hold_id` is enough to drop someone's held slot mid-checkout,
with no check that the caller owns it.

Worth noting what #65 *did* fix, because it is a real improvement:
`create-booking-payment` previously took `renter_id` from the request body and
now derives it from the JWT — meaning it was possible to start a booking as
another user. That is a genuine authorization hole closed.

The two ungated routes should be finished off in a follow-up rather than
treated as oversight — the author flagged the blocker in the commit message.

---

## 4. Still open — all six blockers, plus one new

All are textually `MERGEABLE / CLEAN`, but 9–13 commits behind `main`.

| PR | Branch | Note |
|---|---|---|
| #66 | `fix/reservations-rls` | **verify before merge** — see below |
| #67 | `fix/rate-tier-by-duration` | B4 |
| #68 | `fix/stripe-mobile-payment-element` | likely fixes §2 |
| #69 | `fix/realtime-publication` | chat |
| #70 | `fix/availability-window-and-stale-start` | **wrong base** |
| #71 | `fix/deadlock-retry-on-finalize` | **wrong base** |
| #72 | `adrian-bug-fixes` | new, from Adrian |

**#66 — see §8.** I originally flagged this as "RLS + JWT will silently return
`[]` from the backend". That was wrong: the backend holds a service_role key and
bypasses RLS. Checking it did turn up a real defect, but in
`get_visible_listings` rather than in #66 — see §7.

**#70 and #71 have stale bases.** #70 targets `ci/automated-checks`, which is
now fully contained in `main` — but the branch still exists on origin, so
GitHub did **not** auto-retarget. #71 targets #70. Both need retargeting to
`main` before they can merge sensibly. I did not change them: PR bases are
team-visible.

**#72 (Adrian)** addresses the QA list's "location reset / wrong mileage" item.
It fixes initial location (`handleCurrentLocation()` on scene 2) but *removes
the distance readout entirely* from `DynamicViewer.tsx` rather than correcting
the mileage. Worth a deliberate decision — that may be intended, but it closes
the QA item by deletion.

---

## 5. Local state — nothing was committed

Unchanged in 16 days, still uncommitted/untracked:

```
 M .gitignore
 M frontend/app.json
 M frontend/package.json
?? docs/qa-triage-2026-08-09.md
?? frontend/.env.example
?? frontend/app.config.js
```

Local `main` was 13 behind (now fetched). `holdPayouts` is `[gone]` on origin,
matching the merge on Aug 5.

---

## 6. Suggested order

1. ~~**Apply `20260730005125` to the hosted DB.**~~ **DONE 2026-08-25.** This is the one that stops
   charging renters for bookings the trigger will refuse. It both installs
   `reservation_validation_error()` (restoring the pre-charge check) and
   replaces the strict May trigger with the tier-fallback rule — the two halves
   only work together, which is why the half-state in §1 is worse than either.
2. ~~**Apply `20260720120000`.**~~ **DONE 2026-08-25.** Unblocks every push notification. Independent of
   step 1; it has simply been waiting since July.
3. **Ask Adrian what they saw**, before assuming. §2 argues the tier-mismatch
   trigger, and the timing fits — but they were at the keyboard and I was not.
   Which listing, what duration, which rate columns were set?
4. **Reproduce §1 directly:** book ~10 hours on an hourly listing with no daily
   rate. Expect a charge, a failed booking, and (post-#63) a refund.
5. **Make `get_visible_listings` `SECURITY DEFINER`** (§7). Now confirmed
   live, and it is a correctness bug in the core search screen that appears on
   the first overlapping booking — i.e. under real traffic, not in testing.
6. **Gate `/stripe/finalize-booking` and `/stripe/release-hold`** (§3).
   `release-hold` first — a bare `hold_id` currently frees anyone's slot.
   Now that step 1 makes bookings completable, the blocker that stopped Adrian
   gating them is gone.
7. Merge **#68** and re-test a booking end to end.
8. Retarget **#70 → `main`**, **#71 → #70**.
9. Merge **#66** after correcting its migration comment (§8).
10. Decide the **#72** distance-display question with Adrian.

**Ordering caveat for later:** `0730` and `0808` (PR #70) both redefine
`reservation_validation_error()`. `0808` is written on top of `0730`, so
applying `0808` alone silently drops the rate rules. `0730` first, always.

---

## 7. Second live defect, found while reviewing #66: search ignores checkout holds

Independent of any PR. `get_visible_listings` is the only reservation-reading
function the **frontend** calls; everything else
(`acquire_booking_hold`, `finalize_paid_reservation`, `get_available_listings`,
`release_booking_hold`) is backend-only and runs as service_role.

It is declared `LANGUAGE sql STABLE` with **no `SECURITY DEFINER`** — so it runs
as INVOKER, with the caller's privileges — and is granted
`TO anon, authenticated`. It reads two RLS-protected tables:

**`reservation_holds` — provably broken now.** `20260710120000` runs
`ENABLE ROW LEVEL SECURITY` and creates **no policies at all** (grep confirms
none anywhere). So for every app caller this subquery matches nothing:

```sql
AND NOT EXISTS (
  SELECT 1 FROM public.reservation_holds h
  WHERE h.listing_id = l.id AND h.expires_at > now() ...
)
```

A listing with a live checkout hold is therefore **not excluded from search**.
The backend's `acquire_booking_hold` still refuses at purchase, so this is a
wasted-checkout bug, not a double-booking one: two people can both reach the
payment sheet, and the second is rejected after committing to buy.

**`reservations` — CONFIRMED live.** `relrowsecurity` on
`public.reservations` is **true** (checked in the SQL editor, 2026-08-25), so
RLS is enforced and the three policies are all `TO authenticated`. Inside an
INVOKER function that means `active_res` sees only the caller's *own* bookings.
Consequences, both real today:

- `next_available_at` comes back NULL for any spot booked by someone else, so
  search's *"Not available currently, but you can schedule after {when}"* branch
  never fires.
- `AND (p_include_active_reserved OR ar.ends_at IS NULL)` stops filtering, so
  the home screen shows occupied spots as free.

The only reason nobody has seen this is that there are **zero currently-active
confirmed reservations** — all 19 confirmed bookings have already ended. The
defect surfaces on the first real overlapping booking, i.e. exactly at launch.

**Fix — written:** `supabase/migrations/20260825160000_get_visible_listings_security_definer.sql`.
It `ALTER`s the function to `SECURITY DEFINER` with a pinned `search_path`
rather than re-declaring it, so it cannot overwrite a body that has drifted from
the migration file. DEFINER leaks nothing here: the function is already a
curated projection returning listing columns plus one derived timestamp, never a
reservation or hold row, and its own `WHERE` clause stays the visibility gate.

Verified against a throwaway Postgres 16 container, not just read: it repairs an
already-regressed function, is idempotent across repeated applies, and its guard
raises both when the function is `SECURITY INVOKER` and when it is missing
entirely.

One trap worth knowing, since it is what the guard exists to catch:
`CREATE OR REPLACE FUNCTION` resets every attribute the new statement does not
restate — confirmed empirically, `prosecdef` goes back to `false` and
`proconfig` is cleared. So any future migration that redefines
`get_visible_listings` without repeating `SECURITY DEFINER` silently reintroduces
both bugs. The first version of that guard had this exact failure mode itself:
`pg_get_function_identity_arguments()` renders parameter *names* as well as
types, so matching it against `'boolean, boolean'` found nothing and
`IF NOT (SELECT ...)` evaluated to NULL — passing silently. It now addresses the
function by `regprocedure`, which raises on its own if it is absent.

---

## 8. Are the open PRs safe to merge?

| PR | Verdict |
|---|---|
| **#68** stripe mobile element | **Merge now.** Isolated, highest value, unblocks payments |
| **#67** rate tier by duration | **Merge.** Backend-only, no migration, genuinely fixes overcharging |
| **#69** realtime publication | **Merge.** Safe, but inert until its migration is applied |
| **#66** reservations RLS | **Merge after one check** (below) — idempotent, fails loud, not unsafe |
| **#70 / #71** | **Retarget first.** `0808` must be applied after `0730` |
| **#72** distance display | **Product call** — it deletes the readout rather than fixing it |
| **#59** search exclusion | **CONFLICTING since Jun 28.** Rebase or close |

**#66 — resolved: `relrowsecurity` is `true`.** RLS is already enabled on
`public.reservations` in the hosted DB. So:

- **#66 is a no-op against production, but it is not pointless — merge it.**
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is idempotent and its `DO` guard
  will pass, so applying it changes nothing today. What it changes is the
  *repo*: traced on 2026-08-25, **nothing in `supabase/migrations/` enables RLS
  on `reservations`** — not the base dump, not any merged migration, and not any
  of the seven versions recovered from the remote history. Someone toggled it in
  the dashboard between Aug 8 (when this PR's comment recorded it as off) and
  Aug 25. Until #66 merges, a database rebuilt from this repo comes up with RLS
  **off** on `reservations` — a security-relevant divergence from production.
  #66 is the only thing that closes it.
- **Its migration comment is now wrong and must be fixed before merge.** It
  states that anon "could read every reservation in the table... rewrite any
  booking's price and status, and DELETE bookings outright." Whatever was true
  on Aug 8, it is not true now: with the anon key `reservations` returns 0 rows
  against service_role's 26. Merging the comment as written leaves a false
  security claim in the migration history.
- **It settles §7.** The `reservations` half of that defect is live, not latent.

That also means B2 is already closed in prod — by someone toggling it in the
dashboard rather than by this migration, which is worth knowing, because it is
schema drift: prod is ahead of `supabase/migrations/` here, in the opposite
direction from §1.

**#66 is safe for the backend**, contrary to what I flagged in §4: the backend
holds a **service_role** key (verified — it reads 8 `vehicles` rows whose only
policies are `TO authenticated`), so it bypasses RLS entirely. The JWT work in
#65 changes who the *frontend* is, not what the backend may read.

**#67 does not interact with §1**, checked specifically: an hourly-only listing
booked for 10 hours takes `_compute_hourly_with_day_cap` both before and after
the change, so the strict trigger rejects it identically either way. It neither
fixes nor worsens the charge-then-refund path.

**None of these PRs fix §1.** Applying `0730` still outranks every merge here.

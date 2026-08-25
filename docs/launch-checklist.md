# What's left before SpotOn ships

Consolidated 2026-08-25. Supersedes the scattered "suggested order" sections in
the other docs.

## Blocking — the app cannot ship without these

### 1. The backend is still on ngrok
Nothing works in a shipped build until it has a fixed public address. Plan and
exact settings are in `production-hosting.md`; ~$8/month on Render.

### 2. There is no way to delete an account
**Apple App Store Guideline 5.1.1(v): an app that lets users create an account
must let them delete it from inside the app.** Not just deactivate, and not
"email us". This is one of the most common rejection reasons and it is a hard
gate.

Nothing in `frontend/src` or `backend/` does this today — there is `signOut`
(Profile.tsx:88, logout-button.tsx:25) and nothing else. The backend has no
deletion route.

It is not just a button, either. Deleting a user has to decide what happens to
their reservations, listings, conversations, messages, vehicles, avatar file,
and Stripe Connect account — some of which are other people's records too. A
host who deletes their account still has renters with paid, upcoming bookings.
Worth designing deliberately rather than reaching for `ON DELETE CASCADE`.

### 3. There is no privacy policy
Required as a URL in **both** App Store Connect and Google Play Console, and
Play additionally requires it to be reachable from inside the app. The only
occurrence of "terms" in the codebase is marketing copy in
`Onboarding.tsx:118` (`titlePost: ' terms.'`).

Needs to say what is collected (email, name, avatar, location, vehicle details
including licence plate, payment metadata via Stripe) and who processes it
(Supabase, Stripe, OpenStreetMap/Nominatim for geocoding).

### 4. Nothing from 2026-08-25 has been exercised by a human
Merged or applied today: the mobile payment element fix, the rate-tier fix,
realtime publication, the availability `SECURITY DEFINER` fix, the pre-charge
validation migration, `notification_events`, and the avatars policy. Every
verification so far has been read-only and deliberately so.

One real booking end to end covers the payment sheet, the pre-charge check, the
trigger, finalize, the notification insert and the push. If it completes and a
phone buzzes, all of it is confirmed at once.

## Before taking real money

### 5. Two money-path endpoints have no authentication
`/api/stripe/finalize-booking` and `/api/stripe/release-hold` still take an
opaque id from the request body with no caller identity and no ownership check.
`release-hold` is the sharper one: a `hold_id` is enough to drop someone else's
slot mid-checkout. Context in `state-check-2026-08-25.md` §3.

## Housekeeping

- **13 commits sit unpushed** on `chore/prod-readiness`.
- **#66** — merge after correcting its migration comment. It is a no-op against
  production but the only thing that records the RLS setting in the repo.
- **#70 / #71** — retarget to `main` and to each other; `0808` applies after
  `0730`.
- **#72** — decide whether deleting the distance readout is the intended fix.
- **#59** — conflicting since June. Rebase or close.
- **Three remaining advisor items** — one small migration:
  drop/revoke `get_nearby_listings`, revoke the trigger functions from the public
  API, pin `search_path` on our own functions.
- **PostGIS** — drop it or revive it. See `state-check-2026-08-25.md` §9.

## Not blocking

- Leaked-password protection is Pro-only. Deprioritised.
- Sign in with Apple is **not** required: the rule only applies if other
  third-party sign-in is offered, and the app is email/password only.
- `spatial_ref_sys`, `st_estimatedextent`, `btree_gist` advisor warnings are
  unfixable or cosmetic. See `security-advisor-2026-08-25.md`.

# Supabase security advisor: what's real, what isn't

32 warnings + 1 error, triaged 2026-08-25. Five worth acting on; the rest is
either intentional or unfixable.

## Worth fixing

### 1. The avatars bucket lets anyone list every file — `public_bucket_allows_listing`

The `Avatar public read` policy is `using (bucket_id = 'avatars')`, which grants
a broad SELECT on `storage.objects`. A public bucket **does not need this** to
serve object URLs — it only enables *listing*. So any client can enumerate every
file in the bucket, and since the upload policy keys paths on
`(storage.foldername(name))[1] = auth.uid()::text`, the filenames are user IDs.
That is a user-ID enumeration endpoint nobody intended.

Fix: drop the SELECT policy. Avatar URLs keep working, because public buckets
serve objects without consulting `storage.objects` policies.

This came in with `20260603002952`, the migration recovered from the remote
history — it had never been reviewed, because it had never been in the repo.

### 2. Leaked password protection is off — `auth_leaked_password_protection`
### — BLOCKED: Pro plan only

Supabase's docs confirm it: "Leaked password protection is available on the Pro
Plan and above." The dashboard refuses the toggle on Hobby. Not worth $25/month
on its own — revisit if the project moves to Pro for other reasons.

What is available meanwhile, in Auth settings, and worth setting now:

- **Minimum password length.** Raise it from the default 6. The docs are silent
  on plan gating for this one, so check whether the field is editable.
- **Required character classes** (digits, upper, lower, symbols), same caveat.
- **OAuth providers.** Google and Apple sign-in remove passwords from the threat
  model entirely for anyone who uses them. Worth noting for a different reason
  too: Apple's App Store rules require Sign in with Apple if you offer other
  third-party sign-in options, so this may be on the launch path regardless.

This was the lowest-value item of the five, and it is now the only one with a
price tag. Deprioritised rather than done.

### 3. `get_nearby_listings` is exposed, unsafe-ish, and dead

`SECURITY DEFINER`, mutable `search_path`, executable by `anon` — and per §9 of
the state check it returns zero rows for every query because `listings.location`
is NULL on all 22 rows. Three warnings for a function nothing calls.

Fix: drop it, as part of the PostGIS decision. Or if that decision is deferred,
`REVOKE EXECUTE ... FROM anon, authenticated` now.

### 4. Trigger functions are published as RPC endpoints

`handle_new_user`, `handle_update_user_email` (both `RETURNS trigger`) and
`rls_auto_enable` are `SECURITY DEFINER` and executable by `anon` via
`/rest/v1/rpc/...`. Calling a trigger function directly errors, so exploitability
is low — but there is no reason for them to be on the public API surface at all.

Fix: `REVOKE EXECUTE` from `anon` and `authenticated`.

### 5. `function_search_path_mutable` on our own functions

`acquire_booking_hold`, `finalize_paid_reservation`, `reservation_validation_error`,
`validate_reservation_rate`, `validate_reservation_vehicle_owner`,
`get_available_listings`, and `create_reservation_with_conversation` (three
overloads — worth checking whether all three are still wanted).

These are `SECURITY INVOKER`, so a mutable `search_path` is low risk: they run
with the caller's privileges either way. Still cheap to pin in one migration,
and it silences ten warnings. The pattern is the one already used in
`20260825160000`: `SET search_path = public, pg_temp`.

## Not problems

- **`spatial_ref_sys` RLS disabled** (the ERROR). PostGIS system table, owned by
  the extension — RLS cannot be enabled on it. Map-projection reference data, no
  user data. Unfixable and harmless; goes away only if PostGIS does.
- **`st_estimatedextent` ×6.** PostGIS internal C functions. Extension-owned,
  not ours to change.
- **`extension_in_public: btree_gist`.** Required: it backs the
  `EXCLUDE USING gist (listing_id WITH =, tstzrange(start_time, end_time) WITH &&)`
  constraint in `20260512120000` that prevents double-booking. Moving it is
  invasive and the warning is cosmetic.
- **`extension_in_public: postgis`.** Tied to the drop-or-revive decision.
- **`get_visible_listings` is SECURITY DEFINER, callable by anon** ×2.
  Intentional, added 2026-08-25. It must be DEFINER or it computes availability
  from only the caller's own bookings, and it must be callable by the app. It
  returns listing columns plus a derived timestamp — never a reservation or hold
  row. Correct trade.
- **`get_active_booking_vehicle_for_listing_owner` callable by anon** ×2. Reads
  worse than it is: the body filters on `l.owner_id = auth.uid()`, and
  `auth.uid()` is NULL for `anon`, so it returns nothing. Self-enforcing.
  Worth noting the repo `REVOKE`s it from `PUBLIC` and grants only
  `authenticated` — so the live grant to `anon` is more drift, probably
  Supabase's default privileges re-applying on a later `CREATE OR REPLACE`.

## Suggested order

1 and 2 before launch — they are user-facing and take minutes. 3 and 4 are a
single small migration. 5 whenever, or fold it into the same migration.

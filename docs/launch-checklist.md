# What's left before SpotOn ships

Consolidated 2026-08-25. Supersedes the scattered "suggested order" sections in
the other docs.

## Blocking — the app cannot ship without these

### 1. The backend is still on ngrok
Nothing works in a shipped build until it has a fixed public address. Plan and
exact settings are in `production-hosting.md`; ~$8/month on Render.

### 2. ~~There is no way to delete an account~~ — DONE
Backend `db45523`, frontend control `db45523`/`dd065b4`. Profile → Delete my
account. Deletion anonymises rather than erasing: the FK graph forbids a real
DELETE, and forcing one would take the counterparty's bookings and messages
with it. Refused while a booking is live or a payout is owed. See
`backend/services/account_deletion.py`.

### 3. ~~There is no privacy policy~~ — WRITTEN, not yet live
`site/privacy.html`, open as ehanrsha/SpotOn-Website#6 so it lands at
`spot-on.software/privacy`. Written from the schema, not a template.

One placeholder left — the effective date, Ehan's to set. Store-form answers
and two `Info.plist` fixes are in `app-privacy-declarations.md`.

Still to do after it is live: link to it from inside the app. Play requires
the policy be reachable in-app, and the URL does not exist yet.

### 4. Nothing from 2026-08-25 has been exercised by a human
Merged or applied today: the mobile payment element fix, the rate-tier fix,
realtime publication, the availability `SECURITY DEFINER` fix, the pre-charge
validation migration, `notification_events`, and the avatars policy. Every
verification so far has been read-only and deliberately so.

One real booking end to end covers the payment sheet, the pre-charge check, the
trigger, finalize, the notification insert and the push. If it completes and a
phone buzzes, all of it is confirmed at once.

## Before taking real money

### 5. ~~Two money-path endpoints have no authentication~~ — DONE
`a2bc636`. Both now require a token and check ownership: `release-hold`
scopes the DELETE to the caller inside the query, `finalize-booking`
checks the PaymentIntent's metadata names the caller.

The ownership check on finalize sits above `_finalize_reservation_from_pi`
on purpose — below it, a mismatched caller reaches the refund path and can
refund a stranger's succeeded payment. `test_stripe_endpoint_auth.py` pins
the ordering, not just the presence of the check.

No client change was needed; the app already sent `Authorization` on both.

## Store setup — surfaced 2026-08-25 from App Store Connect

### 6. The app record does not exist yet
App Store Connect shows **No Apps**. Nothing has been reserved. The privacy
policy URL, the app name and the age rating are all entered when the record is
created, so this gates the paperwork rather than the code.

The developer account is an **Individual** account in Ehan Shah's name — there
is no LLC — which is why the privacy policy names him personally as publisher.
Apple shows the individual's legal name as the seller, so the listing and §1
agree. If an LLC is formed later, both change together.

### 7. The name "SpotOn" is worth checking before it is reserved
There is a large US payments company operating as SpotOn (spoton.com). Two
separate problems come from that:

- **App Store names must be unique.** If the name is taken, the record cannot
  be created under it and a fallback is needed anyway.
- **The categories overlap.** Our app is not just similarly named, it also
  processes card payments — which is the situation where an objection is most
  likely, rather than one where the two uses sit comfortably apart.

Reserving a name is cheap to do and expensive to undo once it is on a listing,
in a bundle ID and on a domain. Worth a search first, and "SpotOn Parking"
being the working answer already suggests the concern is real. None of us are
lawyers and this is not advice — it is a flag that the question should be asked
of someone who is.

Note the bundle ID is already `com.spoton.app` and the domain is
`spot-on.software`, so a rename is not free but is much cheaper now than after
submission.

### 8. EU trader status must be declared
App Store Connect is showing the Digital Services Act banner: trader status has
to be provided or the app is removed from the EU App Store. As individuals
rather than a company the answer is likely "not a trader", but it has to be
answered by an Admin or the Account Holder — Ehan.

Only relevant if the app is distributed in the EU. A campus parking app for
Gainesville probably need not be, and limiting the territories is the simpler
answer if so.

## Housekeeping

- **#74** — `chore/prod-readiness`, pushed 2026-08-26 and open against `main`.
  Account deletion, the privacy policy and the endpoint auth. CI on it caught a
  real bug on the first run: the deletion tests needed real Supabase credentials
  to import, so they passed locally and failed all 14 in CI. Fixed in `43d8197`.
  Now 11 behind `main` after #70/#71 landed — a trial merge is clean and the full
  suite passes (88), including the finalize ordering test, but the branch has not
  been updated on the remote.
- **#66** — merge after correcting its migration comment. It is a no-op against
  production but the only thing that records the RLS setting in the repo.
- **#70 / #71** — MERGED 2026-08-26 (`e247000`, `1a8ce23`). Both were pointing at
  branches rather than `main`; `ci/automated-checks` had already been absorbed, so
  merging #70 would have moved nothing while showing green. Retargeted, then merged
  with merge commits so `fae40e7` landed verbatim and #71 collapsed to its own
  commit — a squash would have left #71 re-applying changes already on `main`.
- **#59** — conflicting on all four files it touches; every one has moved in
  `main` since it branched in June. That is a rewrite, not a rebase. It also
  predates CI, so it has never been tested. Re-cut or close.
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

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

### 5. Two money-path endpoints have no authentication
`/api/stripe/finalize-booking` and `/api/stripe/release-hold` still take an
opaque id from the request body with no caller identity and no ownership check.
`release-hold` is the sharper one: a `hold_id` is enough to drop someone else's
slot mid-checkout. Context in `state-check-2026-08-25.md` §3.

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

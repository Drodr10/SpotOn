# How migrations should work

Written 2026-08-25, after a session that made the case for changing this.

## The problem with the current approach

Migrations are applied by pasting SQL into the Supabase dashboard. Nothing
records what has actually run, so the repo and the database drift apart in both
directions without anyone being able to see it. Three things from 2026-08-25,
all real:

- `20260730005125` was merged into `main` and **never applied**. The backend
  called a validation function that did not exist; the call fails open by
  design, so every booking was charged before a check that never ran and then
  refused by a stricter trigger. Silent, and weeks old.
- `20260720120000` sat unapplied since **July**. Every push notification
  no-opped. The July 29th "test notifications" task was never a code task.
- RLS on `public.reservations` is **on in production but no merged migration
  turned it on** — someone enabled it in the dashboard. Drift the other way.

None of these were visible from the code. `main` looked correct every time.

## Where we want to get to

`supabase db push` applies every migration the database has not seen yet, in
order, and records each one in `supabase_migrations.schema_migrations`. One
command, and "what is applied?" becomes a question with an answer.

The CLI is already installed locally (`supabase --version` → 2.106.0). The
project is **not linked** yet — `supabase/.temp/` holds only `cli-latest`.

## Do NOT run `supabase db push` yet

`supabase migration list` on 2026-08-25 showed three groups:

- **5 matched** (through 2026-05-22) — tracked correctly on both sides.
- **8 local-only** — everything from `20260705120000` on. Applied by hand
  through the SQL editor, so the database never recorded them.
- **7 remote-only** — `20260603002952`, `20260710051100`, `20260710054752`,
  `20260710060732`, `20260711041350`, `20260711051430`, `20260711053133`.

The remote-only group needed explaining, and the answer is mostly benign: six of
those seven are the **same migrations as local files**, applied through the CLI
in June/July and later re-created in the repo under hand-written timestamps.
`20260710051100 add_deferred_payouts` is local `20260705120000`;
`20260710054752 add_booking_holds` is local `20260710120000`, and so on. Their
recorded SQL was recovered from `supabase_migrations.schema_migrations` and
compared. `20260710060732` looked like a genuine extra fix (qualifying an
ambiguous `expires_at`) but the local booking-holds file already carries it.

**The seventh was a real gap.** `20260603002952 add_avatar_url_and_bucket` added
`profiles.avatar_url`, created the public `avatars` storage bucket and four RLS
policies on `storage.objects` — and existed nowhere in this repo, while five
application files read `avatar_url`. A database rebuilt from `supabase/migrations/`
would have had no avatars at all. It has been recovered from the remote history
into `20260603002952_add_avatar_url_and_bucket.sql`, deliberately using the same
version number so local and remote line up and it is never re-applied.

### Step 1 — baseline the 8 local-only migrations

Each was verified to be genuinely applied first, by checking that the objects it
creates exist. Only then:

```bash
supabase migration repair --status applied 20260705120000
supabase migration repair --status applied 20260710120000
supabase migration repair --status applied 20260711120000
supabase migration repair --status applied 20260712120000
supabase migration repair --status applied 20260712140000
supabase migration repair --status applied 20260720120000
supabase migration repair --status applied 20260730005125
supabase migration repair --status applied 20260825160000
```

This writes the tracking rows without running any SQL.

**Marking a version applied when it is not means `db push` skips it forever** —
the same silent-gap failure this document exists to prevent, except now with a
tracking table asserting everything is fine. That is why the list above comes
from a verification query, not from memory.

Not included: `20260808120000` (PR #66) and `20260808140000` (PR #70) are not
merged to `main` yet, and `20260603002952` needs no repair because it is already
recorded remotely.

### Baseline completed 2026-08-25

All eight were repaired and `supabase migration list` now shows every local
migration recorded remotely. Six remote-only rows remain
(`20260710051100`…`20260711053133`) — the superseded CLI-timestamped duplicates.
**Leave them.** `db push` ignores remote-only entries, and reverting them would
write to the tracking table purely for cosmetics while losing the audit trail.

### Step 2 — confirm, then use it normally

```bash
supabase migration list   # every row should now show both columns
supabase db push          # after merging anything that adds a migration
```

## Checking migrations before they merge

CI already lints migration filenames, ordering and BEGIN/COMMIT balance
(`.github/workflows/ci.yml`, the `migrations` job). What it does not do is
verify the SQL actually applies — and the comment there explains why the naive
approach fails: the base dump references platform schemas it never creates, so
replaying it on a bare Postgres image dies on `schema "extensions" does not
exist`.

The CLI handles that:

```yaml
- uses: supabase/setup-cli@v1
- run: supabase db start   # applies every migration in order, locally
```

Worth adding once someone can verify it on a real run.

## Why not apply migrations automatically on merge

Tempting, since "merged but not applied" is exactly what bit us. But there is
**no staging project** — auto-apply would put unreviewed DDL straight into
production with no gate between a bad migration and real bookings. Trading a
visible-once-you-look problem for an instant one is not an improvement.

`db push` as a deliberate step, plus `db start` in CI to catch broken SQL before
merge, is the right size for a three-person team. Revisit if a staging project
appears.

## One more thing, once baselined

```bash
supabase db diff --linked
```

This shows anything in production that no migration describes. We already know
about the `reservations` RLS change; worth running once to find out whether it
was the only one. It usually is not.

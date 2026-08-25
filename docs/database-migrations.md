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

Because migrations were applied by hand, the database's migration history table
is almost certainly empty. `db push` would therefore try to replay **everything
from the beginning**, starting with `20260421001633_remote_schema.sql` — a
5,999-line `supabase db pull` dump. Best case it errors; it is not something to
find out on production.

The fix is to *baseline*: tell the database which migrations it already has,
without executing them.

### Step 1 — link and look

```bash
supabase link --project-ref <ref>     # ref is in the dashboard URL
supabase migration list               # local vs remote, side by side
```

`migration list` prints which versions the remote has recorded. **Send that
output before running anything else.** The repair list in step 2 depends
entirely on what it says — if a teammate ever ran `db push`, some rows already
exist and the list is different.

### Step 2 — baseline (the one step to get right)

For each migration that is genuinely already applied:

```bash
supabase migration repair --status applied <version>
```

This writes the tracking row without running the SQL.

**Marking a version applied when it is not means `db push` skips it forever** —
the same silent-gap failure this document exists to prevent, except now with a
tracking table asserting everything is fine. Get the list from step 1, not from
memory.

Two migrations are *not* part of this: `20260808120000` (PR #66) and
`20260808140000` (PR #70) are not merged to `main` yet.

### Step 3 — from then on

```bash
supabase db push
```

Run it after merging anything that adds a migration. It becomes part of
releasing, not a thing someone remembers.

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

# Database migrations

**Production schema changes go through a merged migration file and the deploy
workflow. Not the SQL editor.** Reading data in the SQL editor is fine.

Why: until Nov 2026 we pasted migrations into the SQL editor. That changes the
database but not Supabase's record of what ran, so nobody could tell what was
actually live. Two security migrations from September had never been applied,
and the `listing-photos` bucket never existed, so no listing photo ever uploaded.

## Adding a migration

1. Create `supabase/migrations/<YYYYMMDDHHMMSS>_<what_it_does>.sql`, wrapped in
   `BEGIN; … COMMIT;` so it applies all-or-nothing.
2. Add a pgTAP test in `supabase/tests/database/` if it changes who can do what.
3. Open a PR. CI runs:
   - **migrations (naming + order)**: timestamps ordered and unique
   - **database (pgTAP)**: applies every migration to a fresh database and runs the tests
   - **migrations (production check)**: what this PR would apply to production,
     and whether production has changes the repo doesn't (drift)
4. Merge. **Merging does not touch production.**

## Deploying to production

GitHub → Actions → **migrations (deploy to production)** → Run workflow (from `main`).

| Input | Use |
|---|---|
| `up_to` | Last version to apply, e.g. `20261116150000`, or `all`. Later ones stay pending. |
| `dry_run` | Default on: shows what would be applied. Run once with it on, read the log, then again with it off. |

A reviewer has to approve the `production` environment before the job runs.
It refuses to run from any branch other than `main`, or if production has drifted.

**Migrations that must wait for an app release** (older builds would break):
deploy with `up_to` set to the version just before it, and deploy the rest after
the release is out. Say so in the migration's header comment.

**Urgent hotfix:** merge the migration to `main` first (fast-track review), then
deploy. Don't apply from a branch.

## When the check reports drift

Production has a migration the repo doesn't. Find out what it was:

```sh
supabase migration fetch --linked   # run in a scratch copy: writes files for every history row
```

Then either add it to the repo as a migration file, or, if it duplicates a file
that's already there, remove the stray history row:

```sh
supabase migration repair --linked --status reverted <version>
```

`repair` only edits the history table; it never runs or undoes SQL. Temporary
exceptions go in `supabase/migrations-remote-only.txt`, each with a reason.

## One-time setup (repo admin)

- **Secrets** (Settings → Secrets and variables → Actions → New repository secret):
  - `SUPABASE_ACCESS_TOKEN`: supabase.com → Account → Access Tokens
  - `SUPABASE_DB_PASSWORD`: the production database password
- **Environment** (Settings → Environments → New environment → `production`):
  add required reviewers, and limit deployment branches to `main`.

## Checking what's really live

`supabase/snippets/verify_prod_migrations.sql` (paste into the SQL editor; it only
reads) checks each migration's actual effect, regardless of the history table.

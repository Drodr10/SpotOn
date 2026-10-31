# Moderation runbook (reports + blocks)

Added for App Store Guideline 1.2 (user-generated content). Users can **report**
another user (from a chat) or a listing, and **block** another user (from a
chat). Reports are reviewed by the team; blocks are enforced by the database.

## Where reports land

Supabase dashboard -> **Table Editor -> `reports`**. Users can only insert rows;
nobody can read, edit or delete them from the app, so this table is only visible
to the team (dashboard / service role).

| Column | Meaning |
| --- | --- |
| `reason` | The chip the reporter picked (e.g. "Harassment or threats") |
| `details` | Optional free text, up to 2000 chars |
| `reported_user_id` | Set for user reports -> `profiles.id` |
| `listing_id` | Set for listing reports -> `listings.id` |
| `conversation_id` | The chat the user report was filed from, if any |
| `reporter_id` | Who filed it |
| `status` | `open` -> `reviewing` -> `actioned` or `dismissed` |
| `created_at` / `reviewed_at` | Set `reviewed_at` when you close it |

Handy filter: `status = open`, sorted by `created_at` ascending (oldest first).
Messages for a user report: Table Editor -> `messages`, filter
`conversation_id = <the report's conversation_id>`.

## The 24-hour promise

The app tells reporters: "our team reviews every report within 24 hours."
That is a commitment Apple reviewers and users will hold us to, so **check the
`reports` table at least once a day** (including weekends). For each `open`
report:

1. Set `status = reviewing`.
2. Look at the evidence (the reported profile / listing / the conversation's messages).
3. Take action (below) or decide there is nothing to act on.
4. Set `status` to `actioned` or `dismissed` and `reviewed_at` to now.

Objectionable content (threats, hate, illegal content) should be removed and the
offender ejected promptly -- do not wait for the 24-hour mark.

## Taking action

**Remove a listing** -- Table Editor -> `listings` -> find the row (`listing_id`
from the report) -> set `is_active = false`. This hides it from search without
breaking existing reservations that point at it. Do not delete the row if it has
reservations (foreign keys). For listing photos, also delete the rows in
`listing_images` if the images themselves are the problem.

**Ban a user** -- the account deletion flow deliberately keeps rows other people
depend on, so a ban is: (1) Authentication -> Users -> the user -> **Ban user**
(this blocks sign-in), (2) set `is_active = false` on all of their `listings`,
(3) if they have upcoming reservations, contact the affected renters/owners.
Blocks already stop them messaging anyone who blocked them; a ban stops them
entirely.

**Dismiss** -- no action; set `status = dismissed`.

## How blocking works

- `user_blocks (blocker_id, blocked_id)`: a user manages only their own rows.
- A trigger on `messages` (`messages_block_guard`) rejects any message insert
  with the error `messaging_blocked` when the sender and the other participant
  of the conversation have a block between them **in either direction**. It fires
  for the app and for the backend (`routes/messages.py` uses the service role),
  so a block holds on every path.
- The blocker's inbox hides conversations with blocked users; a collapsed
  **Blocked users** list at the bottom of the Messages screen lets them
  unblock. In a chat, the name pill menu has Report / Block / Unblock.
- Blocking does not delete anything. Existing messages stay in the database for
  moderation.

## Applying the migration

File: `supabase/migrations/20261029120000_add_reports_and_blocks.sql`

> **The migration must be applied to the live Supabase project BEFORE the app
> build that contains this feature ships.** The new Messages and Chat screens
> read `user_blocks` and call `get_block_status`; the report sheet inserts into
> `reports`. Without the migration, reports fail with a generic error (and a
> reviewer testing Guideline 1.2 will see exactly that), and blocks do nothing.
> The old app build is unaffected by the migration.

Option A (what this repo has actually been doing -- see
`docs/database-migrations.md`, which says **not** to run `supabase db push`
until migration history is repaired): open the Supabase dashboard -> **SQL
Editor** -> new query -> paste the whole file -> **Run**. It is wrapped in a
transaction and ends with a verification block that raises an error (and rolls
everything back) if RLS, grants or the trigger did not come out as intended. A
clean run prints no error.

Option B: `supabase db push`, only after the history mismatch in
`docs/database-migrations.md` has been resolved.

Quick checks after applying (SQL Editor):

```sql
select relname, relrowsecurity from pg_class
 where oid in ('public.user_blocks'::regclass, 'public.reports'::regclass);   -- both true

select tgname from pg_trigger
 where tgrelid = 'public.messages'::regclass and tgname = 'messages_block_guard';  -- 1 row
```

Then in the app with two test accounts: block from one, confirm the other sees
"You can't reply to this conversation." and cannot send; file a report and
confirm the row appears in `reports`.

## Known limits

- No rate limit on reports (one user can file many); details text is capped at
  2000 characters by the database.
- Blocks are checked on messages. Reservations, search and listings are not
  filtered by blocks.
- A deleted account's own blocks are removed; reports about or by it are kept.

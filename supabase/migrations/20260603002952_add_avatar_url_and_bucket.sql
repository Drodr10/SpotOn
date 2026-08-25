-- Avatar storage: profiles.avatar_url plus a public `avatars` bucket.
--
-- RECOVERED 2026-08-25 from supabase_migrations.schema_migrations on the hosted
-- database. This migration was applied through the CLI in June but its file was
-- never committed, so `supabase/migrations/` did not describe production: a
-- database rebuilt from this repo had no avatar_url column and no avatars
-- bucket, while backend/routes/profiles.py, Profile.tsx, MenuBar.tsx, Chat.tsx
-- and Messages.tsx all read avatar_url. Avatars would simply not work.
--
-- The version number deliberately matches the one already recorded remotely
-- (20260603002952) so local and remote line up and this is never re-applied.
--
-- SQL is verbatim as executed, with BEGIN/COMMIT added so a replay on a fresh
-- database is atomic.

BEGIN;

-- Add avatar_url to profiles
alter table public.profiles
  add column if not exists avatar_url text;

-- Create public avatars bucket
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- RLS policies on storage.objects scoped to avatars bucket
drop policy if exists "Avatar public read" on storage.objects;
create policy "Avatar public read"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

drop policy if exists "Avatar owner insert" on storage.objects;
create policy "Avatar owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Avatar owner update" on storage.objects;
create policy "Avatar owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Avatar owner delete" on storage.objects;
create policy "Avatar owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;

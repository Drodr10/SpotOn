-- READ-ONLY. Paste into the Supabase SQL editor and send back the result.
-- Shows which migrations are really in the database, regardless of what the
-- migration history says (most were applied by pasting into this editor).
-- Changes nothing: only SELECTs from the system catalogs.

WITH checks(migration, what, applied) AS (
  VALUES
  -- older migrations on main that the history says never ran
  ('20260808120000', 'reservations has RLS on',
     (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reservations'::regclass)),
  ('20260808130000', 'messages + listings published to realtime',
     (SELECT count(*) = 2 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename IN ('messages', 'listings'))),
  ('20260808140000', 'reservation_validation_error() exists',
     to_regprocedure('public.reservation_validation_error(uuid, timestamptz, timestamptz)') IS NOT NULL),
  ('20260825190000', 'avatars bucket NOT listable (no "Avatar public read")',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                  AND tablename = 'objects' AND policyname = 'Avatar public read')),
  ('20260906213000', 'clients cannot UPDATE reservations',
     NOT has_table_privilege('authenticated', 'public.reservations', 'UPDATE')),
  ('20260906223000', 'anon cannot run get_nearby_listings',
     NOT has_function_privilege('anon',
       'public.get_nearby_listings(double precision, double precision, double precision)', 'EXECUTE')),
  ('20261029120000', 'user_blocks + reports tables exist',
     to_regclass('public.user_blocks') IS NOT NULL AND to_regclass('public.reports') IS NOT NULL),

  -- this PR (expected: all false before we start)
  ('20261116120000', 'reservations.vehicle_id ON DELETE SET NULL',
     EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reservations'::regclass
              AND contype = 'f' AND confdeltype = 'n'
              AND confrelid = 'public.vehicles'::regclass)),
  ('20261116130000', 'single listings_select policy',
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename = 'listings' AND policyname = 'listings_select')),
  ('20261116140000', 'vehicles.plate_state column',
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'vehicles' AND column_name = 'plate_state')),
  ('20261116150000', 'guard_listing_terms_during_checkout() exists',
     EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'guard_listing_terms_during_checkout'
              AND pronamespace = 'public'::regnamespace)),
  ('20261116160000', 'get_public_profiles() exists',
     EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_public_profiles'
              AND pronamespace = 'public'::regnamespace)),
  ('20261116170000', 'clients cannot INSERT reservations',
     NOT has_table_privilege('authenticated', 'public.reservations', 'INSERT')),
  ('20261116190000', 'claim_push_token() exists',
     EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_push_token'
              AND pronamespace = 'public'::regnamespace)),
  ('20261116200000', 'listing-photos bucket exists',
     EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'listing-photos'))
)
SELECT migration, what, coalesce(applied, false) AS applied
  FROM checks
UNION ALL
-- the 6 changes made in the dashboard that are not in the repo: what were they?
SELECT version, 'dashboard-only: ' || coalesce(name, '(no name)'), NULL
  FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260710051100', '20260710054752', '20260710060732',
                   '20260711041350', '20260711051430', '20260711053133')
ORDER BY 1;

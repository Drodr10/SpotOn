-- Vehicles: deletable after their bookings end, frozen while a booking or a
-- checkout hold is live, plate_state validated, host RPC returns plate_state.
--
-- Covers:
--   20261116120000_vehicle_fk_set_null.sql
--   20261116140000_vehicle_plate_state_and_booking_lock.sql
--
-- The money-path reason this matters: if a renter can delete or re-plate a car
-- while its payment is in flight, the webhook's reservation insert fails and
-- the renter is charged and then auto-refunded. These assertions are what stop
-- that rule from regressing silently.
--
-- Everything runs inside one transaction and is rolled back, so fixtures never
-- leak. now() is fixed for the whole transaction, which keeps the "live" and
-- "past" windows below deterministic.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(17);

-- ── Fixtures (as postgres, bypassing RLS) ─────────────────────────────────
-- host  = 1111…, renter = 2222…, deleting-account renter = 3333…
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'pgtap-vh-host@example.test',   'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'pgtap-vh-renter@example.test', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'pgtap-vh-leaver@example.test', 'authenticated', 'authenticated');

INSERT INTO public.profiles (id, full_name, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Host',   'pgtap-vh-host@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'Renter', 'pgtap-vh-renter@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'Leaver', 'pgtap-vh-leaver@example.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.listings
  (id, owner_id, address, latitude, longitude, price_per_hour, hourly_rate, is_active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '1 Test St', 30.0, -84.0, 5, 5, true);

INSERT INTO public.vehicles (id, owner_user_id, make, model, color, license_plate, plate_state) VALUES
  -- only booking is in the past → deletable
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Honda',  'Civic',   'Blue',  'PAST001', 'FL'),
  -- on a confirmed booking that has not ended → frozen
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Toyota', 'Corolla', 'Red',   'LIVE002', 'GA'),
  -- on an unexpired checkout hold → frozen
  ('bbbbbbbb-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Ford',   'Focus',   'White', 'HOLD003', 'FL'),
  -- on nothing → freely editable
  ('bbbbbbbb-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Mazda',  '3',       'Black', 'FREE004', NULL),
  -- the leaving renter's two cars, both with only ended bookings
  ('bbbbbbbb-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'Kia',    'Soul',    'Green', 'GONE005', 'NY'),
  ('bbbbbbbb-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333', 'VW',     'Golf',    'Gray',  'GONE006', 'NY');

INSERT INTO public.reservations
  (id, listing_id, renter_id, vehicle_id, start_time, end_time, total_price, status)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001',
   now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 10, 'confirmed'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002',
   now() - interval '1 hour', now() + interval '1 hour', 10, 'confirmed'),
  ('cccccccc-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333', 'bbbbbbbb-0000-0000-0000-000000000005',
   now() - interval '5 days', now() - interval '5 days' + interval '2 hours', 10, 'confirmed'),
  ('cccccccc-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333', 'bbbbbbbb-0000-0000-0000-000000000006',
   now() - interval '6 days', now() - interval '6 days' + interval '2 hours', 10, 'confirmed');

INSERT INTO public.reservation_holds
  (listing_id, renter_id, vehicle_id, start_time, end_time, expires_at)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-000000000003',
   now() + interval '1 day', now() + interval '1 day 2 hours', now() + interval '5 minutes');

-- ── Structure ─────────────────────────────────────────────────────────────
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint
    WHERE conname = 'reservations_vehicle_id_fkey'
      AND conrelid = 'public.reservations'::regclass),
  'n',
  'reservations.vehicle_id FK is ON DELETE SET NULL'
);

-- ── As the renter ─────────────────────────────────────────────────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 1. Car whose only booking is in the past can be deleted.
SELECT lives_ok(
  $$ DELETE FROM public.vehicles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001' $$,
  'renter can delete a car whose only booking has ended'
);

-- 2. Car on a live confirmed booking cannot be re-plated or deleted.
SELECT throws_ok(
  $$ UPDATE public.vehicles SET license_plate = 'SWAP999'
      WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  '23514',
  'This car is on a booking that has not finished yet. You can change or remove it once the booking ends.',
  'renter cannot change the plate of a car on a live confirmed booking'
);

SELECT throws_ok(
  $$ DELETE FROM public.vehicles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  '23514',
  'This car is on a booking that has not finished yet. You can change or remove it once the booking ends.',
  'renter cannot delete a car on a live confirmed booking'
);

-- 3. Car on an unexpired checkout hold cannot be deleted or re-plated.
SELECT throws_ok(
  $$ DELETE FROM public.vehicles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000003' $$,
  '23514',
  'This car is being used for a booking that is checking out right now. Try again in a few minutes.',
  'renter cannot delete a car on a live checkout hold'
);

SELECT throws_ok(
  $$ UPDATE public.vehicles SET plate_state = 'GA'
      WHERE id = 'bbbbbbbb-0000-0000-0000-000000000003' $$,
  '23514',
  'This car is being used for a booking that is checking out right now. Try again in a few minutes.',
  'renter cannot change plate_state of a car on a live checkout hold'
);

-- 4. plate_state must be a real USPS code.
SELECT throws_ok(
  $$ UPDATE public.vehicles SET plate_state = 'XX'
      WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004' $$,
  '23514',
  'new row for relation "vehicles" violates check constraint "vehicles_plate_state_check"',
  'invalid plate_state is rejected by vehicles_plate_state_check'
);

SELECT lives_ok(
  $$ UPDATE public.vehicles SET plate_state = 'FL', license_plate = 'FREE404'
      WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004' $$,
  'renter can edit plate and plate_state of a car on no booking'
);

-- Back to postgres to inspect rows RLS would hide.
RESET role;
RESET "request.jwt.claims";

SELECT is(
  (SELECT count(*)::int FROM public.vehicles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'the past-booking car is actually gone (delete was not silently filtered by RLS)'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.reservations
           WHERE id = 'cccccccc-0000-0000-0000-000000000001' AND vehicle_id IS NULL),
  'the past reservation survives with vehicle_id set to NULL'
);

SELECT results_eq(
  $$ SELECT license_plate, plate_state FROM public.vehicles
      WHERE id = 'bbbbbbbb-0000-0000-0000-000000000004' $$,
  $$ VALUES ('FREE404'::text, 'FL'::text) $$,
  'the free car edit was actually written'
);

-- ── As the host ───────────────────────────────────────────────────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 5. Host RPC returns the car, including plate_state, during the booking.
SELECT results_eq(
  $$ SELECT reservation_id, make, model, color, license_plate, plate_state
       FROM public.get_active_booking_vehicle_for_listing_owner('cccccccc-0000-0000-0000-000000000002') $$,
  $$ VALUES ('cccccccc-0000-0000-0000-000000000002'::uuid,
             'Toyota'::text, 'Corolla'::text, 'Red'::text, 'LIVE002'::text, 'GA'::text) $$,
  'host RPC returns license_plate and plate_state for an in-window booking'
);

SELECT is_empty(
  $$ SELECT * FROM public.get_active_booking_vehicle_for_listing_owner('cccccccc-0000-0000-0000-000000000005') $$,
  'host RPC returns nothing for a booking outside its window'
);

-- ── As someone who is not the host ────────────────────────────────────────
SET LOCAL "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

SELECT is_empty(
  $$ SELECT * FROM public.get_active_booking_vehicle_for_listing_owner('cccccccc-0000-0000-0000-000000000002') $$,
  'host RPC returns nothing to a user who does not own the listing'
);

-- ── As service_role (backend account deletion) ────────────────────────────
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';

-- The lock applies to the backend too: a live booking's car stays put.
SELECT throws_ok(
  $$ DELETE FROM public.vehicles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  '23514',
  'This car is on a booking that has not finished yet. You can change or remove it once the booking ends.',
  'service_role cannot delete a car on a live booking either'
);

-- account_deletion.py: delete every vehicle of a renter whose bookings all ended.
SELECT lives_ok(
  $$ DELETE FROM public.vehicles WHERE owner_user_id = '33333333-3333-3333-3333-333333333333' $$,
  'service_role can delete all vehicles of a renter whose bookings have ended'
);

RESET role;
RESET "request.jwt.claims";

SELECT results_eq(
  $$ SELECT
       (SELECT count(*)::int FROM public.vehicles
         WHERE owner_user_id = '33333333-3333-3333-3333-333333333333'),
       (SELECT count(*)::int FROM public.reservations
         WHERE renter_id = '33333333-3333-3333-3333-333333333333' AND vehicle_id IS NULL) $$,
  $$ VALUES (0, 2) $$,
  'account deletion removed both cars and kept both reservations, unlinked'
);

SELECT * FROM finish();
ROLLBACK;

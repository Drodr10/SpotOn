-- Reservations: clients can read their bookings but can never write one, and
-- the booking RPCs are callable by the backend only.
--
-- Covers:
--   20261116170000_reservations_client_write_lockdown.sql
--
-- Why this matters: before that migration any signed-in user could INSERT a
-- 'confirmed', payout_status 'held' reservation with any price and host_payout
-- they liked (free booking; the payout sweep would then try to transfer the
-- made-up host_payout), directly or through finalize_paid_reservation /
-- create_reservation_with_conversation, which are SECURITY INVOKER and were
-- executable via the default PUBLIC grant.
--
-- One transaction, rolled back at the end.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(29);

-- ── Fixtures (as postgres, bypassing RLS) ─────────────────────────────────
-- host = 4141…, renter = 4242…, stranger = 4343…
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('41414141-4141-4141-4141-414141414141', 'pgtap-rl-host@example.test',     'authenticated', 'authenticated'),
  ('42424242-4242-4242-4242-424242424242', 'pgtap-rl-renter@example.test',   'authenticated', 'authenticated'),
  ('43434343-4343-4343-4343-434343434343', 'pgtap-rl-stranger@example.test', 'authenticated', 'authenticated');

INSERT INTO public.profiles (id, full_name, email) VALUES
  ('41414141-4141-4141-4141-414141414141', 'Host',     'pgtap-rl-host@example.test'),
  ('42424242-4242-4242-4242-424242424242', 'Renter',   'pgtap-rl-renter@example.test'),
  ('43434343-4343-4343-4343-434343434343', 'Stranger', 'pgtap-rl-stranger@example.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.listings
  (id, owner_id, address, latitude, longitude, price_per_hour, hourly_rate, is_active)
VALUES
  ('a4a4a4a4-0000-0000-0000-000000000001', '41414141-4141-4141-4141-414141414141',
   '41 Lockdown St', 30.0, -84.0, 5, 5, true);

INSERT INTO public.vehicles (id, owner_user_id, make, model, color, license_plate) VALUES
  ('b4b4b4b4-0000-0000-0000-000000000001', '42424242-4242-4242-4242-424242424242',
   'Honda', 'Civic', 'Blue', 'LOCK001');

INSERT INTO public.reservations
  (id, listing_id, renter_id, vehicle_id, start_time, end_time, total_price,
   status, payout_status, stripe_payment_intent)
VALUES
  ('c4c4c4c4-0000-0000-0000-000000000001', 'a4a4a4a4-0000-0000-0000-000000000001',
   '42424242-4242-4242-4242-424242424242', 'b4b4b4b4-0000-0000-0000-000000000001',
   now() + interval '2 days', now() + interval '2 days 2 hours', 10,
   'confirmed', 'held', 'pi_pgtap_existing');

-- ── Structure ─────────────────────────────────────────────────────────────
SELECT policies_are(
  'public', 'reservations',
  ARRAY['reservations_parties_select'],
  'reservations has only the parties SELECT policy (no client insert/update policy)'
);

SELECT ok(NOT has_table_privilege('authenticated', 'public.reservations', 'INSERT'),
  'authenticated has no INSERT on reservations');
SELECT ok(NOT has_table_privilege('authenticated', 'public.reservations', 'UPDATE'),
  'authenticated has no UPDATE on reservations');
SELECT ok(NOT has_table_privilege('authenticated', 'public.reservations', 'DELETE'),
  'authenticated has no DELETE on reservations');
SELECT ok(NOT has_table_privilege('anon', 'public.reservations', 'INSERT'),
  'anon has no INSERT on reservations');
SELECT ok(NOT has_table_privilege('anon', 'public.reservations', 'UPDATE'),
  'anon has no UPDATE on reservations');
SELECT ok(NOT has_table_privilege('anon', 'public.reservations', 'DELETE'),
  'anon has no DELETE on reservations');

-- Every overload of each booking RPC: no client role may execute it, the
-- backend (service_role) may. Checked per overload so a new overload added
-- later with the default PUBLIC grant fails this test.
CREATE TEMP TABLE _booking_rpcs ON COMMIT DROP AS
  SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('finalize_paid_reservation', 'create_reservation_with_conversation',
                       'acquire_booking_hold', 'get_available_listings',
                       'reservation_validation_error');
GRANT SELECT ON _booking_rpcs TO anon, authenticated, service_role;

SELECT is(
  (SELECT count(DISTINCT proname)::int FROM _booking_rpcs), 5,
  'all five booking RPCs exist');
SELECT cmp_ok(
  (SELECT count(*)::int FROM _booking_rpcs WHERE proname = 'create_reservation_with_conversation'),
  '>=', 1, 'create_reservation_with_conversation has at least one overload');

SELECT is(
  ARRAY(SELECT oid::regprocedure::text FROM _booking_rpcs
         WHERE proname = 'finalize_paid_reservation'
           AND (has_function_privilege('anon', oid, 'EXECUTE')
             OR has_function_privilege('authenticated', oid, 'EXECUTE'))),
  ARRAY[]::text[], 'anon/authenticated cannot execute finalize_paid_reservation');
SELECT is(
  ARRAY(SELECT oid::regprocedure::text FROM _booking_rpcs
         WHERE proname = 'create_reservation_with_conversation'
           AND (has_function_privilege('anon', oid, 'EXECUTE')
             OR has_function_privilege('authenticated', oid, 'EXECUTE'))),
  ARRAY[]::text[], 'anon/authenticated cannot execute any create_reservation_with_conversation overload');
SELECT is(
  ARRAY(SELECT oid::regprocedure::text FROM _booking_rpcs
         WHERE proname = 'acquire_booking_hold'
           AND (has_function_privilege('anon', oid, 'EXECUTE')
             OR has_function_privilege('authenticated', oid, 'EXECUTE'))),
  ARRAY[]::text[], 'anon/authenticated cannot execute acquire_booking_hold');
SELECT is(
  ARRAY(SELECT oid::regprocedure::text FROM _booking_rpcs
         WHERE proname = 'get_available_listings'
           AND (has_function_privilege('anon', oid, 'EXECUTE')
             OR has_function_privilege('authenticated', oid, 'EXECUTE'))),
  ARRAY[]::text[], 'anon/authenticated cannot execute get_available_listings');
SELECT is(
  ARRAY(SELECT oid::regprocedure::text FROM _booking_rpcs
         WHERE proname = 'reservation_validation_error'
           AND (has_function_privilege('anon', oid, 'EXECUTE')
             OR has_function_privilege('authenticated', oid, 'EXECUTE'))),
  ARRAY[]::text[], 'anon/authenticated cannot execute reservation_validation_error');
SELECT is(
  ARRAY(SELECT oid::regprocedure::text FROM _booking_rpcs
         WHERE NOT has_function_privilege('service_role', oid, 'EXECUTE')),
  ARRAY[]::text[], 'service_role can execute every booking RPC overload');

-- ── As the renter (authenticated) ─────────────────────────────────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"42424242-4242-4242-4242-424242424242","role":"authenticated"}';

SELECT results_eq(
  $$ SELECT id, status::text FROM public.reservations
      WHERE id = 'c4c4c4c4-0000-0000-0000-000000000001' $$,
  $$ VALUES ('c4c4c4c4-0000-0000-0000-000000000001'::uuid, 'confirmed'::text) $$,
  'renter still reads their own reservation'
);

-- The original exploit: a free, already-"paid" booking.
SELECT throws_ok(
  $$ INSERT INTO public.reservations
       (listing_id, renter_id, vehicle_id, start_time, end_time, total_price,
        host_payout, status, payout_status, stripe_charge_id)
     VALUES ('a4a4a4a4-0000-0000-0000-000000000001', '42424242-4242-4242-4242-424242424242',
             'b4b4b4b4-0000-0000-0000-000000000001',
             now() + interval '5 days', now() + interval '5 days 2 hours', 0.01,
             9999, 'confirmed', 'held', 'ch_forged') $$,
  '42501', NULL,
  'renter cannot insert a confirmed/held reservation directly'
);
SELECT throws_ok(
  $$ UPDATE public.reservations SET total_price = 0.01, host_payout = 9999
      WHERE id = 'c4c4c4c4-0000-0000-0000-000000000001' $$,
  '42501', NULL,
  'renter cannot update their reservation'
);
SELECT throws_ok(
  $$ DELETE FROM public.reservations WHERE id = 'c4c4c4c4-0000-0000-0000-000000000001' $$,
  '42501', NULL,
  'renter cannot delete their reservation'
);
SELECT throws_ok(
  $$ SELECT * FROM public.finalize_paid_reservation(
       'a4a4a4a4-0000-0000-0000-000000000001', '42424242-4242-4242-4242-424242424242',
       'b4b4b4b4-0000-0000-0000-000000000001',
       now() + interval '6 days', now() + interval '6 days 2 hours',
       0.01, 0, 9999, 'pi_forged', 'ch_forged') $$,
  '42501', NULL,
  'renter cannot call finalize_paid_reservation'
);
SELECT throws_ok(
  $$ SELECT * FROM public.create_reservation_with_conversation(
       'a4a4a4a4-0000-0000-0000-000000000001', '42424242-4242-4242-4242-424242424242',
       '41414141-4141-4141-4141-414141414141', 'b4b4b4b4-0000-0000-0000-000000000001',
       now() + interval '7 days', now() + interval '7 days 2 hours', 0.01, 0, 0.01) $$,
  '42501', NULL,
  'renter cannot call create_reservation_with_conversation'
);

-- ── As a stranger (authenticated, no stake in the booking) ────────────────
SET LOCAL "request.jwt.claims" = '{"sub":"43434343-4343-4343-4343-434343434343","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.reservations WHERE id = 'c4c4c4c4-0000-0000-0000-000000000001'),
  0, 'a stranger cannot read someone else''s reservation');

-- ── As anon ───────────────────────────────────────────────────────────────
SET LOCAL role anon;
SET LOCAL "request.jwt.claims" = '{"role":"anon"}';

SELECT throws_ok(
  $$ INSERT INTO public.reservations
       (listing_id, renter_id, start_time, end_time, total_price)
     VALUES ('a4a4a4a4-0000-0000-0000-000000000001', '42424242-4242-4242-4242-424242424242',
             now() + interval '8 days', now() + interval '8 days 2 hours', 0.01) $$,
  '42501', NULL,
  'anon cannot insert a reservation'
);
SELECT throws_ok(
  $$ UPDATE public.reservations SET status = 'cancelled'
      WHERE id = 'c4c4c4c4-0000-0000-0000-000000000001' $$,
  '42501', NULL,
  'anon cannot update a reservation'
);
SELECT throws_ok(
  $$ DELETE FROM public.reservations WHERE id = 'c4c4c4c4-0000-0000-0000-000000000001' $$,
  '42501', NULL,
  'anon cannot delete a reservation'
);

-- ── As service_role (the backend: webhook / finalize-booking) ─────────────
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';

SELECT results_eq(
  $$ SELECT reservation_id IS NOT NULL, error_message
       FROM public.finalize_paid_reservation(
         'a4a4a4a4-0000-0000-0000-000000000001', '42424242-4242-4242-4242-424242424242',
         'b4b4b4b4-0000-0000-0000-000000000001',
         now() + interval '3 days', now() + interval '3 days 2 hours',
         10, 1, 9, 'pi_pgtap_new', 'ch_pgtap_new') $$,
  $$ VALUES (true, NULL::text) $$,
  'service_role can finalize a paid booking'
);
SELECT results_eq(
  $$ SELECT status::text, payout_status, total_price, host_payout
       FROM public.reservations WHERE stripe_payment_intent = 'pi_pgtap_new' $$,
  $$ VALUES ('confirmed'::text, 'held'::text, 10.00::numeric(10,2), 9.00::numeric(10,2)) $$,
  'the finalized booking is stored confirmed/held with the backend''s amounts'
);
SELECT results_eq(
  $$ SELECT reservation_id IS NOT NULL, error_message
       FROM public.finalize_paid_reservation(
         'a4a4a4a4-0000-0000-0000-000000000001', '42424242-4242-4242-4242-424242424242',
         'b4b4b4b4-0000-0000-0000-000000000001',
         now() + interval '3 days', now() + interval '3 days 2 hours',
         10, 1, 9, 'pi_pgtap_new', 'ch_pgtap_new') $$,
  $$ VALUES (true, NULL::text) $$,
  'finalize stays idempotent for the backend (same PaymentIntent twice)'
);
SELECT is(
  (SELECT count(*)::int FROM public.reservations WHERE stripe_payment_intent = 'pi_pgtap_new'),
  1, 'the repeat finalize did not create a second row');

SELECT * FROM finish();
ROLLBACK;

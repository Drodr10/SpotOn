-- Listings: bookable terms frozen while a renter is mid-checkout, and owners
-- can still read their own deactivated listings (and its bookings).
--
-- Covers:
--   20261116130000_listings_owner_select.sql
--   20261116150000_listing_edit_checkout_lock.sql
--
-- The money-path reason this matters: a booking is inserted only AFTER payment
-- succeeds, and that insert re-validates rate + availability against the
-- listing. If the host changes those during the hold, the renter is charged and
-- then refunded. These assertions are what stop that rule from regressing
-- silently.
--
-- One transaction, rolled back at the end; now() is fixed for its duration.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(21);

-- ── Fixtures (as postgres, bypassing RLS) ─────────────────────────────────
-- host = 4444…, renter = 5555…, unrelated user = 6666…
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('44444444-4444-4444-4444-444444444444', 'pgtap-lc-host@example.test',   'authenticated', 'authenticated'),
  ('55555555-5555-5555-5555-555555555555', 'pgtap-lc-renter@example.test', 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'pgtap-lc-other@example.test',  'authenticated', 'authenticated');

INSERT INTO public.profiles (id, full_name, email) VALUES
  ('44444444-4444-4444-4444-444444444444', 'Host',   'pgtap-lc-host@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'Renter', 'pgtap-lc-renter@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'Other',  'pgtap-lc-other@example.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.listings
  (id, owner_id, address, latitude, longitude, price_per_hour, hourly_rate, is_active)
VALUES
  -- L1: has a live hold; also has booking history
  ('dddddddd-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   '10 Hold Ave', 30.0, -84.0, 5, 5, true),
  -- L2: no hold → hard delete allowed
  ('dddddddd-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444',
   '20 Free Ave', 30.0, -84.0, 5, 5, true),
  -- L3: live hold, no bookings; hard-DELETE refusal + service_role exemption
  ('dddddddd-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444444',
   '30 Backend Ave', 30.0, -84.0, 5, 5, true);

INSERT INTO public.vehicles (id, owner_user_id, make, model, color, license_plate, plate_state) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   'Honda', 'Civic', 'Blue', 'LCK0001', 'FL');

-- Two past bookings on L1 so we can check the host keeps reading them.
INSERT INTO public.reservations
  (listing_id, renter_id, vehicle_id, start_time, end_time, total_price, status)
VALUES
  ('dddddddd-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   'eeeeeeee-0000-0000-0000-000000000001',
   now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 10, 'confirmed'),
  ('dddddddd-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   'eeeeeeee-0000-0000-0000-000000000001',
   now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 10, 'confirmed');

INSERT INTO public.reservation_holds
  (id, listing_id, renter_id, vehicle_id, start_time, end_time, expires_at)
VALUES
  ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   '55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000001',
   now() + interval '1 day', now() + interval '1 day 2 hours', now() + interval '5 minutes'),
  ('ffffffff-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000003',
   '55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000001',
   now() + interval '1 day', now() + interval '1 day 2 hours', now() + interval '5 minutes');

-- ── Structure ─────────────────────────────────────────────────────────────
-- One SELECT policy, not two permissive ones (multiple_permissive_policies).
SELECT policies_are(
  'public', 'listings',
  ARRAY['listings_select', 'listings_owner_insert', 'listings_owner_update', 'listings_owner_delete'],
  'listings has a single SELECT policy (listings_select) alongside the owner write policies'
);

-- ── As the host, while a renter holds L1 ──────────────────────────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

-- 6. Changing a rate is refused.
SELECT throws_ok(
  $$ UPDATE public.listings SET hourly_rate = 9
      WHERE id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '23514',
  'A renter is checking out at this spot right now. Try again in a few minutes.',
  'host cannot change hourly_rate during a live hold'
);

SELECT throws_ok(
  $$ UPDATE public.listings SET available_until = now() + interval '1 hour'
      WHERE id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '23514',
  'A renter is checking out at this spot right now. Try again in a few minutes.',
  'host cannot narrow the availability window during a live hold'
);

SELECT throws_ok(
  $$ UPDATE public.listings SET is_active = false
      WHERE id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '23514',
  'A renter is checking out at this spot right now. Try again in a few minutes.',
  'host cannot deactivate a listing during a live hold'
);

-- 7. Saving identical values is a harmless no-op.
SELECT lives_ok(
  $$ UPDATE public.listings
        SET hourly_rate = 5, price_per_hour = 5, is_active = true,
            available_from = NULL, available_until = NULL
      WHERE id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'host can save identical terms during a live hold'
);

-- 8. Unrelated columns stay editable.
SELECT lives_ok(
  $$ UPDATE public.listings SET address = '10 Hold Ave, Unit B'
      WHERE id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'host can edit the address during a live hold'
);

SELECT is(
  (SELECT address FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  '10 Hold Ave, Unit B',
  'the address edit was actually written'
);

-- 9. Hard DELETE is refused under a hold, allowed without one. L3 is used
--    because it has no bookings: on L1 the reservations FK would refuse the
--    delete anyway and hide a missing trigger. The real risk is the CASCADE on
--    reservation_holds silently dropping a paying renter's hold.
SELECT throws_ok(
  $$ DELETE FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000003' $$,
  '23514',
  'A renter is checking out at this spot right now. Try again in a few minutes.',
  'host cannot hard-DELETE a listing during a live hold'
);

SELECT lives_ok(
  $$ DELETE FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000002' $$,
  'host can hard-DELETE a listing with no hold'
);

-- ── Expire the hold (as postgres: holds have no client policies) ──────────
RESET role;
RESET "request.jwt.claims";

SELECT is(
  (SELECT count(*)::int FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000002'),
  0,
  'the hold-free listing is actually gone (delete was not silently filtered by RLS)'
);

SELECT is(
  (SELECT count(*)::int FROM public.reservation_holds
    WHERE listing_id = 'dddddddd-0000-0000-0000-000000000003'),
  1,
  'the refused DELETE left the live hold in place (no cascade)'
);

UPDATE public.reservation_holds
   SET expires_at = now() - interval '1 minute'
 WHERE id = 'ffffffff-0000-0000-0000-000000000001';

-- 10. After expiry the host can deactivate, and still reads the listing and its bookings.
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

SELECT lives_ok(
  $$ UPDATE public.listings SET is_active = false, hourly_rate = 7
      WHERE id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'host can deactivate and re-price once the hold has expired'
);

SELECT results_eq(
  $$ SELECT is_active, hourly_rate FROM public.listings
      WHERE id = 'dddddddd-0000-0000-0000-000000000001' $$,
  $$ VALUES (false, 7.00::numeric(10,2)) $$,
  'host still SELECTs own deactivated listing, with the new values'
);

SELECT is(
  (SELECT count(*)::int FROM public.reservations
    WHERE listing_id = 'dddddddd-0000-0000-0000-000000000001'),
  2,
  'host still SELECTs both bookings on own deactivated listing'
);

-- 11. Nobody else sees the inactive listing.
SET LOCAL "request.jwt.claims" = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'a non-owner authenticated user cannot SELECT the inactive listing'
);

SELECT is(
  (SELECT count(*)::int FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000003'),
  1,
  'a non-owner authenticated user can still SELECT an active listing'
);

SET LOCAL role anon;
SET LOCAL "request.jwt.claims" = '{"role":"anon"}';

SELECT is(
  (SELECT count(*)::int FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'anon cannot SELECT the inactive listing'
);

SELECT is(
  (SELECT count(*)::int FROM public.listings WHERE id = 'dddddddd-0000-0000-0000-000000000003'),
  1,
  'anon can still SELECT an active listing'
);

-- Non-owners cannot write it either (RLS filters to zero rows, no error).
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
SELECT is_empty(
  $$ UPDATE public.listings SET address = 'hijacked'
      WHERE id = 'dddddddd-0000-0000-0000-000000000003' RETURNING id $$,
  'a non-owner cannot update someone else''s listing'
);

-- 12. service_role (account deletion) is exempt even during a live hold.
SET LOCAL role service_role;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';

SELECT lives_ok(
  $$ UPDATE public.listings SET is_active = false
      WHERE id = 'dddddddd-0000-0000-0000-000000000003' $$,
  'service_role can deactivate a listing during a live hold'
);

RESET role;
RESET "request.jwt.claims";

SELECT results_eq(
  $$ SELECT l.is_active, l.address,
            (SELECT count(*)::int FROM public.reservation_holds h
              WHERE h.id = 'ffffffff-0000-0000-0000-000000000003' AND h.expires_at > now())
       FROM public.listings l
      WHERE l.id = 'dddddddd-0000-0000-0000-000000000003' $$,
  $$ VALUES (false, '30 Backend Ave'::text, 1) $$,
  'service_role deactivation was written while the hold was live; non-owner update was not'
);

SELECT * FROM finish();
ROLLBACK;

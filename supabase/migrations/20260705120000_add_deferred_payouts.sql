-- Migration: Deferred payouts (list-first, onboard-at-payout)
--
-- Reworks the marketplace to "separate charges and transfers": a buyer's payment
-- is held on SpotOn's platform balance and only transferred to the seller after
-- (a) the parking session ends AND (b) the seller completes Stripe onboarding.
-- See plan: SpotOn — Deferred Payouts.

BEGIN;

-- ── profiles: payout identity + push + onboarding flag ──────────────────────
-- stripe_account_id already exists in the live DB but was never tracked in a
-- migration; formalize it here (idempotent) alongside the new columns.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS payouts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expo_push_token text;

-- ── reservations: payout lifecycle tracking ────────────────────────────────
-- payout_status lifecycle:
--   pending_payment -> payment intent created, awaiting confirmation
--   held            -> payment succeeded; funds on platform; session ongoing
--   payout_ready    -> session end_time passed; seller notified; awaiting onboarding
--   paid_out        -> Transfer created to seller's onboarded account
--   refunded        -> 30-day window elapsed with no onboarding; buyer refunded
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS stripe_payment_intent text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text,
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS payout_ready_at timestamptz;

-- Fast lookups for the webhook (by payment intent) and the sweep (by status).
CREATE INDEX IF NOT EXISTS idx_reservations_payment_intent
  ON public.reservations(stripe_payment_intent);
CREATE INDEX IF NOT EXISTS idx_reservations_payout_status
  ON public.reservations(payout_status);

COMMIT;

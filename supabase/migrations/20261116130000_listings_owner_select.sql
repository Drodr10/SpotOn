-- Let hosts read their own listings, including deactivated ones.
--
-- Until now the only SELECT policy on public.listings was
-- listings_public_select (is_active = true). A host who removed (deactivated) a
-- spot could no longer read it at all, and because reservations_parties_select
-- resolves "you own this listing" through a subquery on public.listings, they
-- also lost read access to every booking ever made on it — including the
-- earnings history. This is why the app currently refuses to remove any spot
-- that has booking history (OWNER_CAN_READ_INACTIVE_LISTINGS in
-- frontend/src/utils/activity.ts).
--
-- listings_public_select is replaced by a single policy,
-- `is_active = true OR owner_id = auth.uid()`, rather than adding a second
-- permissive SELECT policy (which the Supabase security advisor flags as
-- multiple_permissive_policies and which costs an extra policy evaluation per
-- row). For anyone who isn't the owner — including anon, where auth.uid() is
-- NULL — it is identical to the old policy. Owners additionally see their own
-- deactivated rows.
-- Public discovery is unaffected because every non-owner read path filters
-- is_active explicitly rather than relying on RLS:
--   * get_visible_listings (SECURITY DEFINER) — WHERE l.is_active = TRUE
--   * frontend fetchListingsAround / SuggestionsList — .eq('is_active', true)
--
-- Needed by the Edit Listing screen, which reads a listing by id before
-- updating it (listings_owner_update already allows the write).
--
-- NOT AUTO-DEPLOYED: apply to the hosted project manually (SQL editor or
-- `supabase db push`). The app must keep working without it, so the client
-- does not depend on it yet.

BEGIN;

DROP POLICY IF EXISTS listings_owner_select ON public.listings;
DROP POLICY IF EXISTS listings_public_select ON public.listings;
DROP POLICY IF EXISTS listings_select ON public.listings;

-- No TO clause: same roles as the policy it replaces (anon + authenticated).
CREATE POLICY listings_select
  ON public.listings
  FOR SELECT
  USING (is_active = true OR (SELECT auth.uid()) = owner_id);

COMMIT;

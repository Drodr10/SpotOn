-- Freeze a listing's bookable terms while a renter is mid-checkout on it.
--
-- A renter's booking is only inserted AFTER payment succeeds (webhook →
-- finalize_paid_reservation), and that insert re-runs
-- reservation_validation_error through trg_validate_reservation_rate: rate
-- tier present, booking inside available_from / available_until. Hosts can now
-- edit those columns from the app (EditListing). If a host narrows the window,
-- clears the tier being booked, or deactivates the spot during the ~5 minute
-- hold, the paid booking is refused at insert and the renter is charged and
-- then refunded — the failure 20260808140000 was written to rule out.
--
-- The app cannot see reservation_holds (RLS, no client policies), so this is
-- enforced here: while any unexpired hold exists for the listing, changes to
-- those columns are refused with a message the app shows as-is. Holds expire in
-- minutes, so the host just retries. Unrelated columns (address, photo) are
-- not affected.
--
-- Hard DELETE is covered too: the app only deactivates, but
-- listings_owner_delete lets an owner delete directly, and reservation_holds
-- cascades on listing delete — which would drop a live hold out from under a
-- paying renter the same way.
--
-- The backend (service_role) is exempt: its only write here is account
-- deletion deactivating listings, which must not abort halfway through.
--
-- SECURITY DEFINER only to read reservation_holds; it looks at OLD.id alone,
-- search_path is pinned and EXECUTE is revoked from client roles.
--
-- NOT AUTO-DEPLOYED: apply to the hosted project manually, before shipping the
-- build that includes EditListing.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_listing_terms_during_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.hourly_rate, NEW.daily_rate, NEW.weekly_rate, NEW.monthly_rate,
      NEW.price_per_hour, NEW.available_from, NEW.available_until, NEW.is_active)
     IS NOT DISTINCT FROM
     (OLD.hourly_rate, OLD.daily_rate, OLD.weekly_rate, OLD.monthly_rate,
      OLD.price_per_hour, OLD.available_from, OLD.available_until, OLD.is_active)
  THEN
    RETURN NEW;  -- a no-op save of the same values is harmless
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reservation_holds h
    WHERE h.listing_id = OLD.id
      AND h.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'A renter is checking out at this spot right now. Try again in a few minutes.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);  -- OLD for DELETE (NEW is NULL there)
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_listing_terms_during_checkout() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_listing_terms_during_checkout ON public.listings;
CREATE TRIGGER trg_guard_listing_terms_during_checkout
BEFORE UPDATE OF hourly_rate, daily_rate, weekly_rate, monthly_rate, price_per_hour,
                 available_from, available_until, is_active
   OR DELETE
ON public.listings
FOR EACH ROW
EXECUTE FUNCTION public.guard_listing_terms_during_checkout();

COMMIT;

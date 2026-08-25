import pytest
from backend.utils.pricing import calculate_final_price, PricingError
from decimal import Decimal
from datetime import datetime, timedelta, timezone


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def make_listing(hourly=10, daily=None, weekly=None, monthly=None, price_per_hour=None):
    return {
        'hourly_rate': hourly,
        'daily_rate': daily,
        'weekly_rate': weekly,
        'monthly_rate': monthly,
        'price_per_hour': price_per_hour,
    }


def test_boundary_8_9_vs_9_0():
    # hourly_rate 10 => 8.9h cost 89.0; daily_rate 85 => 9.0h should pick daily and be cheaper
    now = datetime.now(timezone.utc)
    start = now
    t_8_9 = start + timedelta(hours=8, minutes=54)  # 8.9 hours
    t_9_0 = start + timedelta(hours=9)

    listing = make_listing(hourly=10, daily=85)

    res1 = calculate_final_price(listing, iso(start), iso(t_8_9))
    res2 = calculate_final_price(listing, iso(start), iso(t_9_0))

    # Cap pricing: daily rate (85) should be chosen for both 8.9h and 9.0h
    assert Decimal('85.00') == res1['subtotal']
    assert Decimal('85.00') == res2['subtotal']


def test_long_booking_on_hourly_only_listing_is_priced_hourly():
    """A listing with no daily_rate is still bookable for more than a day, and
    is charged hourly for the whole span.

    This replaces an older test that asserted the opposite (PricingError). That
    assertion encoded the original strict rule; the engine was later changed to
    fall back across tiers, matching the product ruling — "users should be able
    to still reserve for more than a day, they would just be charged with the
    hourly rate" (2026-07-26). The old test sat red and unnoticed (no CI, see
    issue #45), which is how the engine and the DB trigger drifted apart:
    validate_reservation_rate() still demanded a daily_rate and rejected these
    bookings AFTER Stripe had captured. See migration
    20260730005125_align_reservation_rate_validation.sql.
    """
    start = datetime(2026, 7, 23, 23, 30, tzinfo=timezone.utc)
    end = start + timedelta(hours=10)
    listing = make_listing(hourly=10, daily=None)

    res = calculate_final_price(listing, iso(start), iso(end))

    assert res['tier'] == 'hourly'
    assert Decimal('100.00') == res['subtotal']  # 10h * $10, no daily cap to apply


def test_the_331_regression_prices_and_the_db_accepts_it():
    """The exact booking from the stranded-payment report: 96 hours on a $3/hr
    listing with no daily rate. Pins the amount that was actually captured, so
    if the engine's fallback is ever removed again the divergence resurfaces
    here instead of on a renter's card.
    """
    start = datetime(2026, 7, 23, 23, 30, tzinfo=timezone.utc)
    end = datetime(2026, 7, 27, 23, 30, tzinfo=timezone.utc)  # 96h
    listing = make_listing(hourly=Decimal('3.00'), daily=None)

    res = calculate_final_price(listing, iso(start), iso(end))

    assert res['tier'] == 'hourly'
    assert Decimal('288.00') == res['subtotal']       # 96h * $3
    assert Decimal('43.20') == res['platform_fee']    # 15% hourly/daily fee
    assert Decimal('331.20') == res['total']


def test_legacy_price_per_hour_listing_is_priced():
    """hourly_rate is nullable but price_per_hour is NOT NULL on listings, so a
    listing carrying only the legacy column is a real shape. The engine falls
    back to it; the trigger used to read hourly_rate alone and rejected these
    bookings after capture — the second, quieter instance of the same bug.
    """
    start = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    listing = make_listing(hourly=None, price_per_hour=Decimal('3.00'))

    res = calculate_final_price(listing, iso(start), iso(end))

    assert res['tier'] == 'hourly'
    assert Decimal('6.00') == res['subtotal']
    assert Decimal('6.90') == res['total']


def test_listing_with_no_usable_rate_is_still_refused():
    """The one rejection the engine and the trigger agree on, and the reason the
    trigger was narrowed rather than dropped: no rate anywhere means there is no
    honest price to charge.
    """
    start = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    listing = make_listing(hourly=None, daily=None, weekly=None, monthly=None,
                           price_per_hour=None)

    with pytest.raises(PricingError):
        calculate_final_price(listing, iso(start), iso(end))

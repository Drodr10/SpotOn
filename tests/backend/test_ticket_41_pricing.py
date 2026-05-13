import pytest
from backend.utils.pricing import calculate_final_price, PricingError
from decimal import Decimal
from datetime import datetime, timedelta, timezone


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def make_listing(hourly=10, daily=None, weekly=None, monthly=None):
    return {
        'hourly_rate': hourly,
        'daily_rate': daily,
        'weekly_rate': weekly,
        'monthly_rate': monthly,
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

    assert Decimal('89.00') == res1['subtotal']
    # At 9.0 hours, best-price picks daily (85) instead of hourly (90)
    assert Decimal('85.00') == res2['subtotal']


def test_missing_required_tier_rejected():
    now = datetime.now(timezone.utc)
    start = now
    end = start + timedelta(hours=10)  # daily tier applies
    listing = make_listing(hourly=10, daily=None)
    with pytest.raises(PricingError):
        calculate_final_price(listing, iso(start), iso(end))

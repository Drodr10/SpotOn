"""Rate tier must be chosen by how long the booking is, not by which rates exist.

Deliberately a separate file from test_ticket_41_pricing.py: that file covers the
hourly/daily cap boundary and is being rewritten on another branch. These cases are
about the weekly/monthly selection, which nothing covered before.

Mutation-checked by swapping in origin/main's pricing.py and re-running: exactly
two fail, the two reported cases, which produced tier 'monthly' and 'weekly'
where they should have been 'hourly'. The numbers in their "was billed" comments
are what it actually charged.

The other seven pass either way, on purpose. They are regression guards for
behaviour the fix had to leave alone, and their passing against BOTH
implementations is the evidence that this change is one-directional: it stops
short bookings being captured by a coarse tier and changes nothing else.
"""
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


def price(listing, **delta):
    start = datetime(2026, 8, 10, 9, 0, tzinfo=timezone.utc)
    return calculate_final_price(listing, iso(start), iso(start + timedelta(**delta)))


# ── the two reported cases ────────────────────────────────────────────────────

def test_one_hour_on_a_listing_with_a_monthly_rate_is_billed_hourly():
    """$10/hr + $500/month, booked for one hour: was billed $535.00."""
    res = price(make_listing(hourly=10, monthly=500), hours=1)
    assert res['tier'] == 'hourly'
    assert res['subtotal'] == Decimal('10.00')
    assert res['total'] == Decimal('11.50')     # 10 + 15%


def test_ten_minutes_on_a_listing_with_a_weekly_rate_is_billed_hourly():
    """$3/hr + $50/week, booked for ten minutes: was billed $53.50."""
    res = price(make_listing(hourly=3, weekly=50), minutes=10)
    assert res['tier'] == 'hourly'
    assert res['subtotal'] == Decimal('0.50')   # 3 * (10/60)
    assert res['total'] == Decimal('0.58')      # 0.50 + 15%, half-up


# ── the coarse tiers must still win when they are genuinely cheaper ───────────

def test_a_two_month_booking_still_uses_the_monthly_rate():
    """The discount a monthly rate exists to give must survive the fix."""
    listing = make_listing(hourly=10, monthly=500)
    res = price(listing, days=56)               # 8 weeks == 2 months
    assert res['tier'] == 'monthly'
    assert res['subtotal'] == Decimal('1000.00')
    # Hourly would have been 56*24*10 = $13,440 before fees.
    assert res['total'] == Decimal('1070.00')   # 1000 + 7%


def test_a_two_week_booking_uses_the_weekly_rate():
    listing = make_listing(hourly=10, weekly=100)
    res = price(listing, days=14)
    assert res['tier'] == 'weekly'
    assert res['subtotal'] == Decimal('200.00')


def test_five_weeks_still_prices_monthly_even_though_weekly_would_be_cheaper():
    """Deliberately pinning EXISTING behaviour, not endorsing it.

    Five weeks with weekly $50 and monthly $500: the >= 4 week threshold selects
    monthly at 1.25 units = $625, where five weekly units would be $250. That is
    a pricing-policy question about what a host is owed when both rates apply --
    separate from this bug, which is only that bookings SHORTER than a period
    were billed a whole one. Changing it would move host payout $625 -> $250 on
    bookings that were never mispriced, so it is Ehan's call, not a bug fix.

    This test exists so that decision is made deliberately rather than by
    accident: if someone switches to cheapest-tier-wins, this fails and says why.
    """
    res = price(make_listing(hourly=None, weekly=50, monthly=500), days=35)
    assert res['tier'] == 'monthly'
    assert res['subtotal'] == Decimal('625.00')


# ── edges ─────────────────────────────────────────────────────────────────────

def test_monthly_only_listing_still_prices_a_short_booking_at_the_monthly_rate():
    """Not a bug: it is the only rate the owner published.

    Whether a monthly-only spot should be bookable by the hour at all is a
    listing-constraint question (availability windows), not a pricing one.
    """
    res = price(make_listing(hourly=None, monthly=500), hours=1)
    assert res['tier'] == 'monthly'
    assert res['subtotal'] == Decimal('500.00')


def test_daily_only_listing_is_unaffected():
    res = price(make_listing(hourly=None, daily=40), days=3)
    assert res['tier'] == 'daily'
    assert res['subtotal'] == Decimal('120.00')


def test_listing_with_no_rates_at_all_is_refused():
    with pytest.raises(PricingError):
        price(make_listing(hourly=None, daily=None, weekly=None, monthly=None), hours=2)


def test_host_payout_and_fee_still_reconcile():
    """total == subtotal + platform_fee, and the host is paid the subtotal."""
    res = price(make_listing(hourly=10, monthly=500), hours=1)
    assert res['total'] == res['subtotal'] + res['platform_fee']
    assert res['host_payout'] == res['subtotal']

from decimal import Decimal, ROUND_HALF_UP, getcontext
from datetime import datetime, timezone
from typing import Dict, Any

getcontext().prec = 28


class PricingError(Exception):
    pass


def _parse_iso8601(value):
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        s = value
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
    else:
        raise PricingError('Invalid datetime format')

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def _to_decimal(value):
    if value is None:
        return None
    return Decimal(str(value))


def calculate_final_price(listing: Dict[str, Any], start_ts, end_ts) -> Dict[str, Decimal]:
    start = _parse_iso8601(start_ts)
    end = _parse_iso8601(end_ts)
    if end <= start:
        raise PricingError('end_time must be after start_time')

    duration_seconds = Decimal((end - start).total_seconds())
    dur_hours = duration_seconds / Decimal(3600)
    dur_days = dur_hours / Decimal(24)
    dur_weeks = dur_days / Decimal(7)
    dur_months = dur_weeks / Decimal(4)

    # Load rates
    hourly_rate = _to_decimal(listing.get('hourly_rate'))
    daily_rate = _to_decimal(listing.get('daily_rate'))
    weekly_rate = _to_decimal(listing.get('weekly_rate'))
    monthly_rate = _to_decimal(listing.get('monthly_rate'))

    # Determine required tier by thresholds (must exist on listing)
    eps = Decimal('0.000001')
    if dur_weeks + eps >= Decimal(4):
        required_tier = 'monthly'
        if monthly_rate is None:
            raise PricingError('Monthly bookings not supported for this listing')
    elif dur_days + eps >= Decimal(7):
        required_tier = 'weekly'
        if weekly_rate is None:
            raise PricingError('Weekly bookings not supported for this listing')
    elif dur_hours + eps >= Decimal(9):
        required_tier = 'daily'
        if daily_rate is None:
            raise PricingError('Daily bookings not supported for this listing')
    else:
        required_tier = 'hourly'
        if hourly_rate is None:
            raise PricingError('Hourly bookings not supported for this listing')

    # Build candidate subtotals (prorated for multi-unit durations).
    # Only consider tiers up to and including the required tier to keep threshold semantics in sync with DB trigger.
    tier_order = ['hourly', 'daily', 'weekly', 'monthly']
    required_index = tier_order.index(required_tier)

    candidates = []  # tuples (tier, subtotal, rate, units)
    # hourly always allowed
    if hourly_rate is not None and required_index >= 0:
        candidates.append(('hourly', (hourly_rate * dur_hours), hourly_rate, dur_hours))

    # daily allowed only if required tier is daily or above
    if daily_rate is not None and required_index >= tier_order.index('daily'):
        daily_units = dur_days if dur_days >= Decimal(1) else Decimal(1)
        candidates.append(('daily', (daily_rate * daily_units), daily_rate, daily_units))

    # weekly allowed only if required tier is weekly or above
    if weekly_rate is not None and required_index >= tier_order.index('weekly'):
        weekly_units = dur_weeks if dur_weeks >= Decimal(1) else Decimal(1)
        candidates.append(('weekly', (weekly_rate * weekly_units), weekly_rate, weekly_units))

    # monthly allowed only if required tier is monthly
    if monthly_rate is not None and required_index >= tier_order.index('monthly'):
        monthly_units = dur_months if dur_months >= Decimal(1) else Decimal(1)
        candidates.append(('monthly', (monthly_rate * monthly_units), monthly_rate, monthly_units))

    if not candidates:
        raise PricingError('No rates available for this listing')

    # Choose best (minimum) subtotal to avoid price jumps — but ensure required tier exists (checked above)
    best = min(candidates, key=lambda c: c[1])
    final_tier, subtotal, rate_used, units = best

    # Platform fee rates: short-term (hourly/daily) => 15%; long-term (weekly/monthly) => 7%
    if final_tier in ('hourly', 'daily'):
        fee_rate = Decimal('0.15')
    else:
        fee_rate = Decimal('0.07')

    # Round subtotal to cents
    quant = Decimal('0.01')
    subtotal = subtotal.quantize(quant, rounding=ROUND_HALF_UP)
    platform_fee = (subtotal * fee_rate).quantize(quant, rounding=ROUND_HALF_UP)
    total = (subtotal + platform_fee).quantize(quant, rounding=ROUND_HALF_UP)
    host_payout = (subtotal).quantize(quant, rounding=ROUND_HALF_UP)

    return {
        'subtotal': subtotal,
        'platform_fee': platform_fee,
        'total': total,
        'host_payout': host_payout,
        'tier': final_tier,
        'units': units,
        'rate': rate_used
    }

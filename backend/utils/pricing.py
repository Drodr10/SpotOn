from decimal import Decimal, ROUND_HALF_UP, getcontext
from datetime import datetime, timezone
from typing import Dict, Any, Optional

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


def _compute_hourly_with_day_cap(
    hourly_rate: Decimal,
    daily_rate: Optional[Decimal],
    total_hours: Decimal,
):
    """
    Returns (subtotal, line_items, tier, rate, units).

    Each 24-hour block is charged at min(24 * hourly_rate, daily_rate).
    The partial final block follows the same rule.
    line_items is None when only a single tier is used (pure hourly or pure daily).
    """
    full_days = int(total_hours // Decimal(24))
    remaining_hours = total_hours - Decimal(full_days) * Decimal(24)

    charged_daily_days = Decimal(0)
    charged_hourly_hours = Decimal(0)

    if full_days > 0:
        if daily_rate is not None and hourly_rate * Decimal(24) >= daily_rate:
            charged_daily_days += Decimal(full_days)
        else:
            charged_hourly_hours += Decimal(full_days) * Decimal(24)

    if remaining_hours > 0:
        if daily_rate is not None and hourly_rate * remaining_hours >= daily_rate:
            charged_daily_days += Decimal(1)
        else:
            charged_hourly_hours += remaining_hours

    items = []
    subtotal = Decimal(0)

    if charged_daily_days > 0:
        day_sub = daily_rate * charged_daily_days
        items.append({'tier': 'daily', 'rate': daily_rate, 'units': charged_daily_days, 'subtotal': day_sub})
        subtotal += day_sub

    if charged_hourly_hours > 0:
        hour_sub = hourly_rate * charged_hourly_hours
        items.append({'tier': 'hourly', 'rate': hourly_rate, 'units': charged_hourly_hours, 'subtotal': hour_sub})
        subtotal += hour_sub

    if not items:
        # Degenerate case: 0-hour duration (guarded upstream, but be safe)
        items.append({'tier': 'hourly', 'rate': hourly_rate, 'units': total_hours, 'subtotal': Decimal(0)})

    primary = items[0]
    line_items = items if len(items) > 1 else None
    return subtotal, line_items, primary['tier'], primary['rate'], primary['units']


def _compute_daily_only(daily_rate: Decimal, dur_days: Decimal):
    units = dur_days if dur_days >= Decimal(1) else Decimal(1)
    subtotal = daily_rate * units
    return subtotal, None, 'daily', daily_rate, units


def calculate_final_price(listing: Dict[str, Any], start_ts, end_ts) -> Dict[str, Any]:
    start = _parse_iso8601(start_ts)
    end = _parse_iso8601(end_ts)
    if end <= start:
        raise PricingError('end_time must be after start_time')

    duration_seconds = Decimal((end - start).total_seconds())
    dur_hours = duration_seconds / Decimal(3600)
    dur_days = dur_hours / Decimal(24)
    dur_weeks = dur_days / Decimal(7)
    dur_months = dur_weeks / Decimal(4)

    hourly_rate = _to_decimal(listing.get('hourly_rate'))
    if hourly_rate is None:
        hourly_rate = _to_decimal(listing.get('price_per_hour'))
    daily_rate = _to_decimal(listing.get('daily_rate'))
    weekly_rate = _to_decimal(listing.get('weekly_rate'))
    monthly_rate = _to_decimal(listing.get('monthly_rate'))

    line_items = None
    subtotal = None

    # ── Weekly / monthly listings ──────────────────────────────────────────────
    if weekly_rate is not None or monthly_rate is not None:
        eps = Decimal('0.000001')
        if monthly_rate is not None and (dur_weeks + eps >= Decimal(4) or weekly_rate is None):
            tier = 'monthly'
            units = dur_months if dur_months >= Decimal(1) else Decimal(1)
            rate_used = monthly_rate
        elif weekly_rate is not None:
            tier = 'weekly'
            units = dur_weeks if dur_weeks >= Decimal(1) else Decimal(1)
            rate_used = weekly_rate
        elif daily_rate is not None:
            tier = 'daily'
            units = dur_days if dur_days >= Decimal(1) else Decimal(1)
            rate_used = daily_rate
        elif hourly_rate is not None:
            subtotal, line_items, tier, rate_used, units = _compute_hourly_with_day_cap(hourly_rate, daily_rate, dur_hours)
        else:
            raise PricingError('No rates available for this listing')

        if subtotal is None:
            subtotal = rate_used * units

    # ── Hourly listings: use hourly rate as base, cap per day when daily_rate set ─
    else:
        if hourly_rate is None and daily_rate is not None:
            subtotal, line_items, tier, rate_used, units = _compute_daily_only(daily_rate, dur_days)
        elif hourly_rate is None:
            raise PricingError('No hourly rate available for this listing')
        else:
            subtotal, line_items, tier, rate_used, units = _compute_hourly_with_day_cap(hourly_rate, daily_rate, dur_hours)

    # ── Fee ────────────────────────────────────────────────────────────────────
    if tier in ('hourly', 'daily'):
        fee_rate = Decimal('0.15')
    else:
        fee_rate = Decimal('0.07')

    quant = Decimal('0.01')
    subtotal = subtotal.quantize(quant, rounding=ROUND_HALF_UP)
    platform_fee = (subtotal * fee_rate).quantize(quant, rounding=ROUND_HALF_UP)
    total = (subtotal + platform_fee).quantize(quant, rounding=ROUND_HALF_UP)
    host_payout = subtotal.quantize(quant, rounding=ROUND_HALF_UP)

    result: Dict[str, Any] = {
        'subtotal': subtotal,
        'platform_fee': platform_fee,
        'total': total,
        'host_payout': host_payout,
        'tier': tier,
        'units': units,
        'rate': rate_used,
    }
    if line_items is not None:
        result['line_items'] = line_items
    return result

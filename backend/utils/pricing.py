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


def _fee_rate(tier: str) -> Decimal:
    """Platform fee by tier: short stays 15%, long stays 7%."""
    return Decimal('0.15') if tier in ('hourly', 'daily') else Decimal('0.07')


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

    # ── Tier selection ─────────────────────────────────────────────────────────
    # A tier is eligible when the STAY IS ACTUALLY THAT LONG. It used to be
    # eligible when the RATE MERELY EXISTED, which is the entire bug: any listing
    # with a weekly or monthly rate took the long-stay path, where `units` is
    # floored at 1, so a short booking was billed a whole period. A $10/hr listing
    # with a $500 monthly rate charged $535 for one hour; $3/hr with $50/week
    # charged $53.50 for ten minutes. The hourly and daily branches below were
    # unreachable for any such listing — which is why this never showed up as a
    # wrong number in the common case, only as a wrong TIER.
    #
    # The duration thresholds and their precedence are unchanged from before, so
    # a booking long enough to have qualified for a coarse tier still gets exactly
    # the same price. This fix only stops SHORT bookings being captured.
    eps = Decimal('0.000001')

    coarse = None
    if monthly_rate is not None and dur_weeks + eps >= Decimal(4):
        m_units = dur_months if dur_months >= Decimal(1) else Decimal(1)
        coarse = (monthly_rate * m_units, None, 'monthly', monthly_rate, m_units)
    elif weekly_rate is not None and dur_days + eps >= Decimal(7):
        w_units = dur_weeks if dur_weeks >= Decimal(1) else Decimal(1)
        coarse = (weekly_rate * w_units, None, 'weekly', weekly_rate, w_units)

    if coarse is not None:
        subtotal, line_items, tier, rate_used, units = coarse
    elif hourly_rate is not None:
        # Folds in the daily rate, capping each full day at daily_rate.
        subtotal, line_items, tier, rate_used, units = _compute_hourly_with_day_cap(
            hourly_rate, daily_rate, dur_hours)
    elif daily_rate is not None:
        subtotal, line_items, tier, rate_used, units = _compute_daily_only(daily_rate, dur_days)
    elif weekly_rate is not None:
        # Too short to qualify, but a week is the finest rate published for this
        # listing, so it is what the booking costs.
        w_units = dur_weeks if dur_weeks >= Decimal(1) else Decimal(1)
        subtotal, line_items, tier, rate_used, units = (
            weekly_rate * w_units, None, 'weekly', weekly_rate, w_units)
    elif monthly_rate is not None:
        m_units = dur_months if dur_months >= Decimal(1) else Decimal(1)
        subtotal, line_items, tier, rate_used, units = (
            monthly_rate * m_units, None, 'monthly', monthly_rate, m_units)
    else:
        raise PricingError('No rates available for this listing')

    # ── Fee ────────────────────────────────────────────────────────────────────
    fee_rate = _fee_rate(tier)

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

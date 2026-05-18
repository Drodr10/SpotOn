type RateSource = {
  hourly_rate?: number | null;
  daily_rate?: number | null;
  weekly_rate?: number | null;
  monthly_rate?: number | null;
  price_per_hour?: number | null;
};

export function getPrimaryRate(
  l: RateSource,
): { value: number; unit: 'hr' | 'day' | 'wk' | 'mo' } | null {
  if (l.hourly_rate != null) return { value: l.hourly_rate, unit: 'hr' };
  if (l.daily_rate != null) return { value: l.daily_rate, unit: 'day' };
  if (l.weekly_rate != null) return { value: l.weekly_rate, unit: 'wk' };
  if (l.monthly_rate != null) return { value: l.monthly_rate, unit: 'mo' };
  if (l.price_per_hour != null) return { value: l.price_per_hour, unit: 'hr' };
  return null;
}

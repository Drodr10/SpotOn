/**
 * Day-selectability rules for DateRangePicker, kept free of React Native so
 * they can be unit-tested in the plain node Jest project.
 */

/** Local-midnight timestamp of `d`'s calendar day (time-of-day ignored). */
export const startOfLocalDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export type DaySelectableOptions = {
  /** "Now", injectable for tests. Days before its local calendar day are never selectable. */
  today?: Date;
  /** Caller's earliest allowed day (inclusive, by calendar day). */
  minDate?: Date | null;
  /** Caller's latest allowed day (inclusive, by calendar day). */
  maxDate?: Date | null;
};

/**
 * Whether the user may pick `day` (start or end) in the picker.
 * Past days (before today, local time) are never selectable, whatever minDate
 * says. Values already chosen earlier (e.g. an existing listing window that
 * started in the past) are not affected — this only gates new taps.
 */
export function isDaySelectable(day: Date, opts: DaySelectableOptions = {}): boolean {
  const t = startOfLocalDay(day);
  if (t < startOfLocalDay(opts.today ?? new Date())) return false;
  if (opts.minDate && t < startOfLocalDay(opts.minDate)) return false;
  if (opts.maxDate && t > startOfLocalDay(opts.maxDate)) return false;
  return true;
}

/** Shared "time remaining" bucketing used by the MenuBar countdown and the
 * Homescreen upcoming-reservation banner, so both render the same units. */
export type TimerData =
  | { mode: 'months'; months: number }
  | { mode: 'weeks';  weeks: number }
  | { mode: 'days';   days: number; hours: number }
  | { mode: 'hours';  hours: number; mins: number }
  | { mode: 'mins';   mins: number; secs: number };

export function formatRemaining(ms: number): TimerData {
  if (ms <= 0) return { mode: 'mins', mins: 0, secs: 0 };
  const totalSecs   = Math.floor(ms / 1000);
  const totalMins   = Math.floor(totalSecs / 60);
  const totalHrs    = Math.floor(totalMins / 60);
  const totalDays   = Math.floor(totalHrs / 24);
  const totalWks    = Math.floor(totalDays / 7);
  const totalMonths = Math.floor(totalWks / 4);
  if (totalMonths >= 1) return { mode: 'months', months: totalMonths };
  if (totalWks    >= 1) return { mode: 'weeks',  weeks: totalWks };
  if (totalDays   >= 1) return { mode: 'days',   days: totalDays, hours: totalHrs % 24 };
  if (totalHrs    >= 1) return { mode: 'hours',  hours: totalHrs, mins: totalMins % 60 };
  return { mode: 'mins', mins: totalMins, secs: totalSecs % 60 };
}

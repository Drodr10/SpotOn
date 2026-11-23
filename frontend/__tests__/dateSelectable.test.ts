/**
 * isDaySelectable — which DateRangePicker cells can be tapped.
 * Regression: past days were pickable and not greyed out.
 */
import { isDaySelectable, startOfLocalDay } from '../src/utils/dateSelectable';

// Local-time constructors throughout: the picker works in the device's zone.
const TODAY = new Date(2026, 10, 16, 15, 30); // Nov 16 2026, 3:30 PM

describe('isDaySelectable', () => {
  it('rejects days before today', () => {
    expect(isDaySelectable(new Date(2026, 10, 15), { today: TODAY })).toBe(false);
    expect(isDaySelectable(new Date(2026, 9, 31), { today: TODAY })).toBe(false);
    expect(isDaySelectable(new Date(2025, 10, 20), { today: TODAY })).toBe(false);
  });

  it('allows today regardless of time of day', () => {
    expect(isDaySelectable(new Date(2026, 10, 16), { today: TODAY })).toBe(true);
    expect(isDaySelectable(new Date(2026, 10, 16, 23, 59), { today: TODAY })).toBe(true);
    expect(isDaySelectable(new Date(2026, 10, 16, 0, 0), { today: new Date(2026, 10, 16, 23, 59) })).toBe(true);
  });

  it('allows future days, across month and year boundaries', () => {
    expect(isDaySelectable(new Date(2026, 10, 17), { today: TODAY })).toBe(true);
    expect(isDaySelectable(new Date(2027, 0, 1), { today: TODAY })).toBe(true);
  });

  it('a minDate in the past does not re-open past days', () => {
    const minDate = new Date(2026, 10, 1);
    expect(isDaySelectable(new Date(2026, 10, 10), { today: TODAY, minDate })).toBe(false);
    expect(isDaySelectable(new Date(2026, 10, 16), { today: TODAY, minDate })).toBe(true);
  });

  it('a future minDate is inclusive by calendar day', () => {
    const minDate = new Date(2026, 10, 20, 18, 0);
    expect(isDaySelectable(new Date(2026, 10, 19), { today: TODAY, minDate })).toBe(false);
    expect(isDaySelectable(new Date(2026, 10, 20), { today: TODAY, minDate })).toBe(true);
  });

  it('maxDate is inclusive by calendar day', () => {
    const maxDate = new Date(2026, 10, 30, 1, 0);
    expect(isDaySelectable(new Date(2026, 10, 30), { today: TODAY, maxDate })).toBe(true);
    expect(isDaySelectable(new Date(2026, 11, 1), { today: TODAY, maxDate })).toBe(false);
  });

  it('a maxDate before today leaves nothing selectable', () => {
    const maxDate = new Date(2026, 10, 10);
    expect(isDaySelectable(new Date(2026, 10, 16), { today: TODAY, maxDate })).toBe(false);
  });

  it('null bounds behave like no bounds', () => {
    expect(isDaySelectable(new Date(2026, 10, 18), { today: TODAY, minDate: null, maxDate: null })).toBe(true);
  });

  it('defaults "today" to the real current day', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    expect(isDaySelectable(now)).toBe(true);
    expect(isDaySelectable(yesterday)).toBe(false);
  });
});

describe('startOfLocalDay', () => {
  it('drops the time of day', () => {
    expect(startOfLocalDay(new Date(2026, 10, 16, 15, 30))).toBe(new Date(2026, 10, 16).getTime());
  });
});

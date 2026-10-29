import { buildHourSeries, RollingCounter, startOfHour } from './error-hours';

const HOUR = 3_600_000;

describe('buildHourSeries', () => {
  it('returns 24 buckets ending at the current hour, zero-filled', () => {
    const now = Date.UTC(2026, 9, 29, 10, 42);
    const current = startOfHour(now);
    const series = buildHourSeries(
      [
        { hour: current, errors: 2, warnings: 1 },
        // Container lain di jam yang sama dijumlahkan.
        { hour: current, errors: 3, warnings: 0 },
        { hour: current - 2 * HOUR, errors: 1, warnings: 4 },
        // Di luar jendela.
        { hour: current - 30 * HOUR, errors: 9, warnings: 9 },
      ],
      now,
    );

    expect(series).toHaveLength(24);
    expect(series[23]).toEqual({
      hour: '2026-10-29T10:00:00.000Z',
      errors: 5,
      warnings: 1,
    });
    expect(series[22]).toMatchObject({ errors: 0, warnings: 0 });
    expect(series[21]).toMatchObject({ errors: 1, warnings: 4 });
    expect(series[0].hour).toBe('2026-10-28T11:00:00.000Z');
  });
});

describe('RollingCounter', () => {
  it('only counts events inside the window', () => {
    const counter = new RollingCounter(HOUR);
    counter.add('api', 0);
    counter.add('api', 30 * 60_000);
    counter.add('api', 50 * 60_000);

    expect(counter.count('api', 55 * 60_000)).toBe(3);
    expect(counter.count('api', 70 * 60_000)).toBe(2);
    expect(counter.count('api', 200 * 60_000)).toBe(0);
    expect(counter.keys()).toEqual([]);
  });
});

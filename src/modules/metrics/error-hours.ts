import type { ErrorHourDto } from './dto/error-hour.dto';

const HOUR_MS = 3_600_000;

export const startOfHour = (time: number) =>
  Math.floor(time / HOUR_MS) * HOUR_MS;

export interface HourCount {
  hour: number;
  errors: number;
  warnings: number;
}

// `hours` bucket terakhir sampai jam sekarang, jam kosong diisi nol.
// Semua container dijumlahkan.
export const buildHourSeries = (
  counts: HourCount[],
  now: number,
  hours = 24,
): ErrorHourDto[] => {
  const current = startOfHour(now);
  const byHour = new Map<number, { errors: number; warnings: number }>();
  counts.forEach(({ hour, errors, warnings }) => {
    const bucket = byHour.get(hour) ?? { errors: 0, warnings: 0 };
    bucket.errors += errors;
    bucket.warnings += warnings;
    byHour.set(hour, bucket);
  });

  return Array.from({ length: hours }, (_, index) => {
    const hour = current - (hours - 1 - index) * HOUR_MS;
    const bucket = byHour.get(hour);
    return {
      hour: new Date(hour).toISOString(),
      errors: bucket?.errors ?? 0,
      warnings: bucket?.warnings ?? 0,
    };
  });
};

// Jendela geser 60 menit per container, untuk alert error spike.
export class RollingCounter {
  private readonly times = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  add(key: string, time: number): void {
    const list = this.times.get(key) ?? [];
    list.push(time);
    this.times.set(key, list);
  }

  count(key: string, now: number): number {
    const list = this.times.get(key);
    if (!list) return 0;
    const cutoff = now - this.windowMs;
    const firstValid = list.findIndex((time) => time > cutoff);
    if (firstValid === -1) {
      this.times.delete(key);
      return 0;
    }
    if (firstValid > 0) list.splice(0, firstValid);
    return list.length;
  }

  keys(): string[] {
    return [...this.times.keys()];
  }
}

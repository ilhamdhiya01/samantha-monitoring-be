import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { LogLevel } from '../logs/dto/log-line.dto';
import type { ErrorHourDto } from './dto/error-hour.dto';
import {
  buildHourSeries,
  HourCount,
  RollingCounter,
  startOfHour,
} from './error-hours';

const HOUR_MS = 3_600_000;
const FLUSH_MS = 60_000;

interface Pending {
  hour: number;
  container: string;
  errors: number;
  warnings: number;
}

// Menghitung baris ERROR/WARN dari ingestor log. Hitungan dikumpulkan di
// memori lalu di-upsert ke Postgres tiap menit (bukan per baris) — nginx
// yang ramai tidak boleh berarti satu query per baris.
@Injectable()
export class ErrorCounterService implements OnModuleDestroy {
  private pending = new Map<string, Pending>();
  private readonly recentErrors = new RollingCounter(HOUR_MS);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  record(container: string, level: LogLevel, time: number): void {
    if (level === 'INFO') return;
    const hour = startOfHour(time);
    const key = `${hour}|${container}`;
    const entry = this.pending.get(key) ?? {
      hour,
      container,
      errors: 0,
      warnings: 0,
    };
    if (level === 'ERROR') {
      entry.errors += 1;
      this.recentErrors.add(container, time);
    } else {
      entry.warnings += 1;
    }
    this.pending.set(key, entry);
  }

  // Error 60 menit terakhir per container (alert error spike).
  errorsLastHour(now = Date.now()): Map<string, number> {
    const result = new Map<string, number>();
    this.recentErrors.keys().forEach((container) => {
      const count = this.recentErrors.count(container, now);
      if (count > 0) result.set(container, count);
    });
    return result;
  }

  async hourly(now = Date.now(), hours = 24): Promise<ErrorHourDto[]> {
    const since = new Date(startOfHour(now) - (hours - 1) * HOUR_MS);
    const rows = await this.prisma.errorHourly.findMany({
      where: { hour: { gte: since } },
      select: { hour: true, errors: true, warnings: true },
    });
    // Hitungan yang belum di-flush ikut dijumlahkan supaya grafik terkini.
    const counts: HourCount[] = [
      ...rows.map((row) => ({ ...row, hour: row.hour.getTime() })),
      ...this.pending.values(),
    ];
    return buildHourSeries(counts, now, hours);
  }

  @Interval(FLUSH_MS)
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      await this.prisma.$transaction(
        [...batch.values()].map((entry) =>
          this.prisma.errorHourly.upsert({
            where: {
              hour_container: {
                hour: new Date(entry.hour),
                container: entry.container,
              },
            },
            create: {
              hour: new Date(entry.hour),
              container: entry.container,
              errors: entry.errors,
              warnings: entry.warnings,
            },
            update: {
              errors: { increment: entry.errors },
              warnings: { increment: entry.warnings },
            },
          }),
        ),
      );
    } catch (error) {
      // Kembalikan ke antrean; dicoba lagi menit berikutnya.
      batch.forEach((entry, key) => {
        const current = this.pending.get(key);
        this.pending.set(
          key,
          current
            ? {
                ...current,
                errors: current.errors + entry.errors,
                warnings: current.warnings + entry.warnings,
              }
            : entry,
        );
      });
      this.logger.warn('metrics.flush_failed', {
        error: (error as Error).message,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}

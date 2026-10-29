import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '../../common/prisma/prisma.service';

const DAY_MS = 86_400_000;
export const ERROR_HOURLY_RETENTION_DAYS = 30;
export const DEPLOY_EVENT_RETENTION_DAYS = 90;
export const ALERT_RETENTION_DAYS = 90;

// Supaya monitor sendiri tidak bikin disk penuh (risiko PRD).
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  @Cron('0 3 * * *')
  async purge(now = Date.now()): Promise<void> {
    const before = (days: number) => new Date(now - days * DAY_MS);
    try {
      const [errors, deploys, alerts] = await this.prisma.$transaction([
        this.prisma.errorHourly.deleteMany({
          where: { hour: { lt: before(ERROR_HOURLY_RETENTION_DAYS) } },
        }),
        this.prisma.deployEvent.deleteMany({
          where: { occurredAt: { lt: before(DEPLOY_EVENT_RETENTION_DAYS) } },
        }),
        this.prisma.alert.deleteMany({
          where: { resolvedAt: { lt: before(ALERT_RETENTION_DAYS) } },
        }),
      ]);
      this.logger.info('retention.purged', {
        errorHourly: errors.count,
        deployEvents: deploys.count,
        alerts: alerts.count,
      });
    } catch (error) {
      this.logger.warn('retention.failed', {
        error: (error as Error).message,
      });
    }
  }
}

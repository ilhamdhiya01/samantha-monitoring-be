import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MetricsModule } from '../metrics/metrics.module';
import { LogHistoryService } from './log-history.service';
import { LogIngestorService } from './log-ingestor.service';
import { LogsController } from './logs.controller';

@Module({
  imports: [EventsModule, MetricsModule],
  controllers: [LogsController],
  providers: [LogIngestorService, LogHistoryService],
})
export class LogsModule {}

import { Module } from '@nestjs/common';
import { ContainersModule } from '../containers/containers.module';
import { EventsModule } from '../events/events.module';
import { MetricsModule } from '../metrics/metrics.module';
import { SystemModule } from '../system/system.module';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [EventsModule, SystemModule, ContainersModule, MetricsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEvaluatorService, TelegramService],
  exports: [AlertsService],
})
export class AlertsModule {}

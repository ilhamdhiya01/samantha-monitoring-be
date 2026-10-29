import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ContainersModule } from './modules/containers/containers.module';
import { DockerModule } from './modules/docker/docker.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { ImagesModule } from './modules/images/images.module';
import { LogsModule } from './modules/logs/logs.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { RetentionModule } from './modules/retention/retention.module';
import { StreamModule } from './modules/stream/stream.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [
    CommonModule,
    DockerModule,
    EventsModule,
    SystemModule,
    ContainersModule,
    ImagesModule,
    MetricsModule,
    LogsModule,
    AlertsModule,
    StreamModule,
    RetentionModule,
    HealthModule,
  ],
})
export class AppModule {}

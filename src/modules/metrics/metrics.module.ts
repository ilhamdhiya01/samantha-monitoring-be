import { Module } from '@nestjs/common';
import { ErrorCounterService } from './error-counter.service';
import { MetricsController } from './metrics.controller';

@Module({
  controllers: [MetricsController],
  providers: [ErrorCounterService],
  exports: [ErrorCounterService],
})
export class MetricsModule {}

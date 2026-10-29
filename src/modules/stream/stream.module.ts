import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { ContainersModule } from '../containers/containers.module';
import { SystemModule } from '../system/system.module';
import { StreamController } from './stream.controller';

@Module({
  imports: [SystemModule, ContainersModule, AlertsModule],
  controllers: [StreamController],
})
export class StreamModule {}

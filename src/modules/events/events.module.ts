import { Module } from '@nestjs/common';
import { DeploysController } from './deploys.controller';
import { DeploysService } from './deploys.service';
import { DockerEventsService } from './docker-events.service';

@Module({
  controllers: [DeploysController],
  providers: [DockerEventsService, DeploysService],
  exports: [DockerEventsService],
})
export class EventsModule {}

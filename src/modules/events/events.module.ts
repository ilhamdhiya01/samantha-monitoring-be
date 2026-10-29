import { Module } from '@nestjs/common';
import { DockerEventsService } from './docker-events.service';

@Module({
  providers: [DockerEventsService],
  exports: [DockerEventsService],
})
export class EventsModule {}

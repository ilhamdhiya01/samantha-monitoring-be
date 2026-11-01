import { Module } from '@nestjs/common';
import { ContainersModule } from '../containers/containers.module';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';

@Module({
  imports: [ContainersModule],
  controllers: [ActionsController],
  providers: [ActionsService],
})
export class ActionsModule {}

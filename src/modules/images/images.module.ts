import { Module } from '@nestjs/common';
import { ContainersModule } from '../containers/containers.module';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Module({
  imports: [ContainersModule],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}

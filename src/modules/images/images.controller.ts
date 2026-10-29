import { Controller, Get } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ImagesService } from './images.service';

@Controller('images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  // Baca saja. Rollback & prune = aksi tulis, masuk v1.1.
  @Get()
  @ResponseMessage('Daftar image')
  summary() {
    return this.imagesService.summary();
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DeploysService } from './deploys.service';
import type { DeployEventDto } from './dto/deploy-event.dto';

@Controller('deploys')
export class DeploysController {
  constructor(private readonly deploysService: DeploysService) {}

  @Get()
  @ResponseMessage('Riwayat deploy')
  list(@Query('container') container?: string): Promise<DeployEventDto[]> {
    return this.deploysService.recent(container || undefined);
  }
}

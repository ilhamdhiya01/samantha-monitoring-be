import { Controller, Get } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AlertsService } from './alerts.service';
import type { AlertDto } from './dto/alert.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get('active')
  @ResponseMessage('Alert aktif')
  active(): Promise<AlertDto[]> {
    return this.alertsService.active();
  }
}

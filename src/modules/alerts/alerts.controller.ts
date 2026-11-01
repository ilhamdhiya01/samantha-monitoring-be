import { Controller, Get, Query } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AlertsService } from './alerts.service';
import type { AlertDto, AlertHistoryDto } from './dto/alert.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get('active')
  @ResponseMessage('Alert aktif')
  active(): Promise<AlertDto[]> {
    return this.alertsService.active();
  }

  @Get('history')
  @ResponseMessage('Riwayat alert')
  history(@Query('container') container?: string): Promise<AlertHistoryDto[]> {
    return this.alertsService.history(container || undefined);
  }
}

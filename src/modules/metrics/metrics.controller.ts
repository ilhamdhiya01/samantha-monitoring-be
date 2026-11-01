import { Controller, Get, Query } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ErrorCounterService } from './error-counter.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly errorCounter: ErrorCounterService) {}

  // Grafik error/warning per jam, 24 jam terakhir. Tanpa ?container= =
  // semua container dijumlahkan.
  @Get('errors-hourly')
  @ResponseMessage('Error per jam')
  errorsHourly(@Query('container') container?: string) {
    return this.errorCounter.hourly(container || undefined);
  }
}

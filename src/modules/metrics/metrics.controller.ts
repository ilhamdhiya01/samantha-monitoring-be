import { Controller, Get } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ErrorCounterService } from './error-counter.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly errorCounter: ErrorCounterService) {}

  // Grafik error/warning per jam, 24 jam terakhir, semua container.
  @Get('errors-hourly')
  @ResponseMessage('Error per jam')
  errorsHourly() {
    return this.errorCounter.hourly();
  }
}

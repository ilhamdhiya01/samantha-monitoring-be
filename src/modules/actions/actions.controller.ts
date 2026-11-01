import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ActionsService } from './actions.service';
import type {
  ActionStatusDto,
  ContainerActionResultDto,
} from './dto/container-action.dto';
import { ContainerActionBodyDto } from './dto/container-action.dto';

// Hanya JSON: dari situs lain itu memicu preflight CORS dan diblokir. Body
// form/text bisa dikirim lintas situs tanpa preflight (CSRF), dan Express
// mem-parse form juga — jadi tolak eksplisit di sini.
const metaOf = (request: Request) => {
  if (!request.is('application/json')) {
    throw new UnsupportedMediaTypeException('Body harus application/json');
  }
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
};

@Controller()
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  @Get('actions/status')
  @ResponseMessage('Status aksi')
  status(): ActionStatusDto {
    return this.actionsService.status();
  }

  @Post('containers/:name/stop')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Container dihentikan')
  stop(
    @Param('name') name: string,
    @Body() body: ContainerActionBodyDto,
    @Req() request: Request,
  ): Promise<ContainerActionResultDto> {
    return this.actionsService.run(name, 'stop', body.confirm, metaOf(request));
  }

  @Post('containers/:name/start')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Container dijalankan')
  start(
    @Param('name') name: string,
    @Body() body: ContainerActionBodyDto,
    @Req() request: Request,
  ): Promise<ContainerActionResultDto> {
    return this.actionsService.run(
      name,
      'start',
      body.confirm,
      metaOf(request),
    );
  }
}

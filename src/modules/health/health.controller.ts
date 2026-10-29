import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DockerService } from '../docker/docker.service';

// Untuk uptime monitor EKSTERNAL (healthchecks.io, UptimeRobot): kalau VPS
// atau monitor ini mati, tidak ada yang bisa mengirim alert dari dalam.
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ResponseMessage('Health checked')
  async check(@Res({ passthrough: true }) res: Response) {
    const [db, docker] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.docker.ping(),
    ]);
    const status = db && docker ? 'ok' : 'down';
    if (status === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status, db, docker };
  }
}

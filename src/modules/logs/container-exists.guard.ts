import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LogHistoryService } from './log-history.service';

// Dipasang di endpoint SSE log. Di Nest 11 hanya guard yang jalan sebelum
// header text/event-stream ditulis (pipe dan handler ditunda), jadi
// container tak dikenal tetap jadi 404 JSON biasa — bukan respons 200
// berisi `event: error` yang membuat EventSource reconnect terus.
@Injectable()
export class ContainerExistsGuard implements CanActivate {
  constructor(private readonly history: LogHistoryService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.history.assertExists(String(request.params.name));
    return true;
  }
}

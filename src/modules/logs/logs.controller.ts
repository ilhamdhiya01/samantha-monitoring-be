import {
  Controller,
  Header,
  Headers,
  MessageEvent,
  Param,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { interval, map, merge, Observable } from 'rxjs';
import type { LogLineDto } from './dto/log-line.dto';
import { ContainerExistsGuard } from './container-exists.guard';
import { LogHistoryService } from './log-history.service';
import { LogIngestorService } from './log-ingestor.service';
import { isAfterId } from './log-line';
import { LineThrottle } from './sse-throttle';

export const HEARTBEAT_MS = 15_000;
export const RECONNECT_MS = 3_000;

const logEvent = (line: LogLineDto): MessageEvent => ({
  id: line.id,
  type: 'log',
  data: line,
});

@Controller('logs')
export class LogsController {
  constructor(
    private readonly ingestor: LogIngestorService,
    private readonly history: LogHistoryService,
    private readonly configService: ConfigService,
  ) {}

  // GET /api/v1/logs/:name/stream — event `log` (LogLineDto), `skipped`
  // ({ count }) dan `ping`. Saat dibuka: 500 baris terakhir lalu baris
  // live. Saat reconnect (header Last-Event-ID dari browser, atau
  // ?lastEventId= saat FE membuka ulang sendiri): lanjut dari baris itu.
  @Sse(':name/stream')
  @UseGuards(ContainerExistsGuard)
  // Nginx: jangan buffer response ini.
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  stream(
    @Param('name') name: string,
    @Headers('last-event-id') lastEventIdHeader: string | undefined,
    @Query('lastEventId') lastEventIdQuery: string | undefined,
  ): Observable<MessageEvent> {
    const resumeId = lastEventIdHeader || lastEventIdQuery || undefined;
    const maxPerSecond =
      this.configService.get<number>('logs.sseMaxLinesPerSec') ?? 50;

    return merge(
      this.lines(name, resumeId, maxPerSecond),
      interval(HEARTBEAT_MS).pipe(
        map((): MessageEvent => ({ type: 'ping', data: {} })),
      ),
    );
  }

  // Riwayat dulu, baru live. Baris live yang datang selama riwayat diambil
  // ditahan, lalu hanya yang lebih baru dari baris riwayat terakhir yang
  // dikirim — tidak ada yang hilang di celahnya, tidak ada yang dobel.
  private lines(
    name: string,
    resumeId: string | undefined,
    maxPerSecond: number,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const throttle = new LineThrottle(maxPerSecond);
      const held: LogLineDto[] = [];
      let isReady = false;
      let lastId = resumeId;

      const sendLive = (line: LogLineDto) => {
        if (!isAfterId(line.id, lastId)) return;
        lastId = line.id;
        if (throttle.accept(Date.now())) subscriber.next(logEvent(line));
      };

      const live = this.ingestor.lines$(name).subscribe((line) => {
        if (isReady) sendLive(line);
        else held.push(line);
      });

      const skippedTimer = setInterval(() => {
        const count = throttle.drainSkipped();
        if (count > 0) subscriber.next({ type: 'skipped', data: { count } });
      }, 1_000);

      this.history
        .history(name, resumeId)
        .then((lines) => {
          lines.forEach((line, index) => {
            subscriber.next({
              ...logEvent(line),
              // Petunjuk interval reconnect untuk EventSource.
              ...(index === 0 ? { retry: RECONNECT_MS } : {}),
            });
          });
          lastId = lines.at(-1)?.id ?? lastId;
          isReady = true;
          held.splice(0).forEach(sendLive);
        })
        .catch((error: unknown) => subscriber.error(error));

      return () => {
        live.unsubscribe();
        clearInterval(skippedTimer);
      };
    });
  }
}

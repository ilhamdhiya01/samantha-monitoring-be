import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Observable, Subject, Subscription } from 'rxjs';
import { Logger } from 'winston';
import { DockerService } from '../docker/docker.service';
import { DockerLogReader } from '../docker/log-stream';
import { DockerEventsService } from '../events/docker-events.service';
import { ErrorCounterService } from '../metrics/error-counter.service';
import type { LogLineDto } from './dto/log-line.dto';
import { LogLineFactory } from './log-line';

interface Attachment {
  containerId: string;
  stream: NodeJS.ReadableStream & { destroy?: () => void };
}

// Mengikuti log SEMUA container yang running, sepanjang waktu — grafik
// error per jam dan alert error spike butuh setiap baris, bukan hanya
// container yang sedang dibuka di browser. Satu stream Docker per
// container; semua tab browser berbagi stream ini lewat Subject (fan-out
// di memori, tanpa Redis — backend satu proses).
@Injectable()
export class LogIngestorService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly attachments = new Map<string, Attachment>();
  private readonly subjects = new Map<string, Subject<LogLineDto>>();
  private eventsSubscription: Subscription | undefined;

  constructor(
    private readonly docker: DockerService,
    private readonly events: DockerEventsService,
    private readonly errorCounter: ErrorCounterService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // Baris live satu container (berdasarkan nama, jadi tetap tersambung
  // saat container di-recreate dengan nama yang sama).
  lines$(name: string): Observable<LogLineDto> {
    return this.subjectFor(name).asObservable();
  }

  async onApplicationBootstrap(): Promise<void> {
    this.eventsSubscription = this.events.events$.subscribe((event) => {
      if (event.action === 'start') {
        void this.attach(event.containerId, event.time);
      }
    });
    try {
      const running = await this.docker.client.listContainers();
      // Mulai dari sekarang: baris lama sudah dihitung sebelum restart
      // monitor (atau sengaja tidak dihitung saat pertama dipasang).
      const now = Date.now();
      await Promise.all(running.map((c) => this.attach(c.Id, now)));
    } catch (error) {
      this.logger.warn('logs.ingest.list_failed', {
        error: (error as Error).message,
      });
    }
  }

  onModuleDestroy(): void {
    this.eventsSubscription?.unsubscribe();
    this.attachments.forEach(({ stream }) => {
      stream.removeAllListeners();
      stream.destroy?.();
    });
    this.attachments.clear();
    this.subjects.forEach((subject) => subject.complete());
    this.subjects.clear();
  }

  private subjectFor(name: string): Subject<LogLineDto> {
    let subject = this.subjects.get(name);
    if (!subject) {
      subject = new Subject<LogLineDto>();
      this.subjects.set(name, subject);
    }
    return subject;
  }

  private async attach(containerId: string, sinceMs: number): Promise<void> {
    try {
      const container = this.docker.client.getContainer(containerId);
      const info = await container.inspect();
      const name = info.Name.replace(/^\//, '');
      if (this.attachments.get(name)?.containerId === containerId) return;
      this.detach(name);

      const stream = (await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        since: Math.floor(sinceMs / 1000),
      })) as Attachment['stream'];
      this.attachments.set(name, { containerId, stream });

      const reader = new DockerLogReader(info.Config.Tty);
      const factory = new LogLineFactory();
      const subject = this.subjectFor(name);
      const emit = (chunk: Buffer) => {
        reader.push(chunk).forEach((raw) => {
          const line = factory.create(raw);
          const time = Date.parse(line.ts);
          // `since` berdetik; buang baris sebelum titik mulai.
          if (time < sinceMs - 1000) return;
          this.errorCounter.record(name, line.level, time);
          subject.next(line);
        });
      };

      stream.on('data', emit);
      stream.on('error', (error: Error) => {
        this.logger.warn('logs.ingest.stream_error', {
          container: name,
          error: error.message,
        });
      });
      // Stream selesai saat container berhenti; attach ulang terjadi lewat
      // event `start` berikutnya.
      stream.on('end', () => {
        if (this.attachments.get(name)?.containerId === containerId) {
          this.attachments.delete(name);
        }
      });
      this.logger.info('logs.ingest.attached', { container: name });
    } catch (error) {
      this.logger.warn('logs.ingest.attach_failed', {
        containerId: containerId.slice(0, 12),
        error: (error as Error).message,
      });
    }
  }

  private detach(name: string): void {
    const current = this.attachments.get(name);
    if (!current) return;
    current.stream.removeAllListeners();
    current.stream.destroy?.();
    this.attachments.delete(name);
  }
}

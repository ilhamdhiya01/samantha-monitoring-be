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
import { isAfterId, LogLineFactory } from './log-line';

interface Attachment {
  containerId: string;
  stream: NodeJS.ReadableStream & { destroy?: () => void };
}

// Titik mulai sebuah attach: waktu (attach baru) atau baris terakhir yang
// sudah diproses (sambung ulang — baris ≤ afterId dibuang supaya tidak
// dihitung dua kali).
interface ResumePoint {
  sinceMs: number;
  afterId?: string;
}

// Jeda sebelum menyambung ulang stream yang putus; naik hanya kalau stream
// langsung putus lagi (hidup < HEALTHY_STREAM_MS tanpa membawa baris).
// Container yang memang sepi diputus proxy tiap 10 menit — itu sehat.
export const RESUME_BACKOFF_MS = [1_000, 5_000, 15_000, 60_000];
export const HEALTHY_STREAM_MS = 30_000;

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
  private readonly resumeTimers = new Set<NodeJS.Timeout>();
  private eventsSubscription: Subscription | undefined;
  private isStopped = false;

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
        void this.attach(event.containerId, { sinceMs: event.time });
      }
    });
    try {
      const running = await this.docker.client.listContainers();
      // Mulai dari sekarang: baris lama sudah dihitung sebelum restart
      // monitor (atau sengaja tidak dihitung saat pertama dipasang).
      const now = Date.now();
      await Promise.all(
        running.map((c) => this.attach(c.Id, { sinceMs: now })),
      );
    } catch (error) {
      this.logger.warn('logs.ingest.list_failed', {
        error: (error as Error).message,
      });
    }
  }

  onModuleDestroy(): void {
    this.isStopped = true;
    this.resumeTimers.forEach((timer) => clearTimeout(timer));
    this.resumeTimers.clear();
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

  private async attach(
    containerId: string,
    from: ResumePoint,
    attempt = 0,
  ): Promise<void> {
    if (this.isStopped) return;
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
        since: Math.floor(from.sinceMs / 1000),
      })) as Attachment['stream'];
      const attachment: Attachment = { containerId, stream };
      this.attachments.set(name, attachment);

      const reader = new DockerLogReader(info.Config.Tty);
      const factory = new LogLineFactory();
      const subject = this.subjectFor(name);
      let lastId = from.afterId;
      let lastTime = from.sinceMs;
      let hasData = false;
      const openedAt = Date.now();

      const emit = (chunk: Buffer) => {
        reader.push(chunk).forEach((raw) => {
          const line = factory.create(raw);
          const time = Date.parse(line.ts);
          // `since` berdetik: buang baris sebelum titik mulai, atau yang
          // sudah diproses sebelum sambung ulang.
          if (from.afterId) {
            if (!isAfterId(line.id, from.afterId)) return;
          } else if (time < from.sinceMs - 1000) {
            return;
          }
          hasData = true;
          lastId = line.id;
          lastTime = time;
          this.errorCounter.record(name, line.level, time);
          subject.next(line);
        });
      };

      let isEnded = false;
      const handleEnd = () => {
        if (isEnded) return;
        isEnded = true;
        if (this.attachments.get(name) !== attachment) return;
        this.attachments.delete(name);
        // Stream juga putus tanpa container berhenti: docker-socket-proxy
        // (HAProxy) memutus koneksi yang diam > 10 menit, jadi container
        // yang jarang menulis log kehilangan stream-nya. Sambung ulang dari
        // baris terakhir selama container masih running; container yang
        // benar-benar berhenti di-attach lagi lewat event `start`.
        this.scheduleResume(
          containerId,
          name,
          { sinceMs: lastTime, afterId: lastId },
          hasData || Date.now() - openedAt >= HEALTHY_STREAM_MS
            ? 0
            : attempt + 1,
        );
      };

      stream.on('data', emit);
      stream.on('error', (error: Error) => {
        this.logger.warn('logs.ingest.stream_error', {
          container: name,
          error: error.message,
        });
      });
      stream.on('end', handleEnd);
      stream.on('close', handleEnd);
      this.logger.info(
        from.afterId ? 'logs.ingest.resumed' : 'logs.ingest.attached',
        { container: name },
      );
    } catch (error) {
      this.logger.warn('logs.ingest.attach_failed', {
        containerId: containerId.slice(0, 12),
        error: (error as Error).message,
      });
    }
  }

  private scheduleResume(
    containerId: string,
    name: string,
    from: ResumePoint,
    attempt: number,
  ): void {
    if (this.isStopped) return;
    const delay =
      RESUME_BACKOFF_MS[Math.min(attempt, RESUME_BACKOFF_MS.length - 1)];
    const timer = setTimeout(() => {
      this.resumeTimers.delete(timer);
      void this.resumeIfRunning(containerId, name, from, attempt);
    }, delay);
    this.resumeTimers.add(timer);
  }

  private async resumeIfRunning(
    containerId: string,
    name: string,
    from: ResumePoint,
    attempt: number,
  ): Promise<void> {
    // Sudah ada stream lain untuk nama ini (container di-recreate).
    if (this.isStopped || this.attachments.has(name)) return;
    try {
      const info = await this.docker.client.getContainer(containerId).inspect();
      if (!info.State.Running) return;
    } catch {
      // Container sudah dihapus.
      return;
    }
    await this.attach(containerId, from, attempt);
  }

  private detach(name: string): void {
    const current = this.attachments.get(name);
    if (!current) return;
    current.stream.removeAllListeners();
    current.stream.destroy?.();
    this.attachments.delete(name);
  }
}

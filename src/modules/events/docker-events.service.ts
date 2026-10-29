import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Observable, Subject } from 'rxjs';
import { Logger } from 'winston';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DockerService } from '../docker/docker.service';
import { LineSplitter } from '../docker/log-stream';
import {
  DockerContainerEvent,
  RawDockerEvent,
  toContainerEvent,
} from './docker-event.types';

const ACTIONS = ['create', 'start', 'die', 'stop', 'kill', 'destroy'];
const BACKOFF_MS = [1_000, 3_000, 10_000, 30_000];

// Satu stream /events untuk seluruh proses, dibagikan lewat Subject ke
// ingestor log (attach saat `start`) dan evaluator alert. Event `create`
// disimpan sebagai riwayat deploy — Docker sendiri tidak menyimpan event
// lama, jadi riwayat dimulai sejak monitor dipasang.
@Injectable()
export class DockerEventsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly subject = new Subject<DockerContainerEvent>();
  private stream: (NodeJS.ReadableStream & { destroy?: () => void }) | null =
    null;
  private retryTimer: NodeJS.Timeout | undefined;
  private attempt = 0;
  private lastEventSec = 0;
  private isStopped = false;

  constructor(
    private readonly docker: DockerService,
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  get events$(): Observable<DockerContainerEvent> {
    return this.subject.asObservable();
  }

  onApplicationBootstrap(): void {
    void this.connect();
  }

  onModuleDestroy(): void {
    this.isStopped = true;
    clearTimeout(this.retryTimer);
    this.destroyStream();
    this.subject.complete();
  }

  private async connect(): Promise<void> {
    if (this.isStopped) return;
    try {
      const stream = await this.docker.client.getEvents({
        // Setelah reconnect, ambil event yang terlewat selama putus.
        ...(this.lastEventSec ? { since: this.lastEventSec } : {}),
        filters: { type: ['container'], event: ACTIONS },
      });
      this.stream = stream;
      this.attempt = 0;
      this.logger.info('docker.events.connected');

      const splitter = new LineSplitter();
      stream.on('data', (chunk: Buffer) => {
        splitter.push(chunk.toString('utf8')).forEach((line) => {
          this.handleLine(line);
        });
      });
      stream.on('error', (error: Error) => {
        this.logger.warn('docker.events.error', { error: error.message });
      });
      stream.on('end', () => this.scheduleReconnect());
      stream.on('close', () => this.scheduleReconnect());
    } catch (error) {
      this.logger.warn('docker.events.connect_failed', {
        error: (error as Error).message,
      });
      this.scheduleReconnect();
    }
  }

  private handleLine(line: string): void {
    let raw: RawDockerEvent;
    try {
      raw = JSON.parse(line) as RawDockerEvent;
    } catch {
      return;
    }
    const event = toContainerEvent(raw);
    if (!event) return;
    this.lastEventSec = Math.floor(event.time / 1000);
    this.subject.next(event);
    if (event.action === 'create') {
      void this.recordDeploy(event);
    }
  }

  private async recordDeploy(event: DockerContainerEvent): Promise<void> {
    try {
      const info = await this.docker.client
        .getContainer(event.containerId)
        .inspect();
      await this.prisma.deployEvent.create({
        data: {
          container: info.Name.replace(/^\//, ''),
          imageId: info.Image,
          image: event.image || info.Config.Image,
          occurredAt: new Date(event.time),
        },
      });
    } catch (error) {
      this.logger.warn('docker.events.deploy_record_failed', {
        container: event.name,
        error: (error as Error).message,
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.isStopped || this.retryTimer) return;
    this.destroyStream();
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, delay);
  }

  private destroyStream(): void {
    const stream = this.stream;
    this.stream = null;
    stream?.removeAllListeners();
    stream?.destroy?.();
  }
}

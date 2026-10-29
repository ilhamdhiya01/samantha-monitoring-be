import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { ContainerInfo, ContainerInspectInfo } from 'dockerode';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Observable, Subject } from 'rxjs';
import { Logger } from 'winston';
import { DockerService } from '../docker/docker.service';
import {
  cpuPercentFromStats,
  memoryFromStats,
  RawContainerStats,
  splitImageRef,
  toContainerStatus,
} from './container-stats';
import type { ContainerDto } from './dto/container.dto';

export const CONTAINERS_POLL_MS = 5_000;

// imageId hanya untuk kebutuhan internal (tabel images), tidak dikirim ke FE.
export const toContainerDtos = (list: ContainerSnapshot[]): ContainerDto[] =>
  list.map((container) => {
    const dto: Partial<ContainerSnapshot> = { ...container };
    delete dto.imageId;
    return dto as ContainerDto;
  });

// Data internal: DTO + image id (untuk tabel images, tidak dikirim ke FE).
export interface ContainerSnapshot extends ContainerDto {
  imageId: string;
}

// Satu putaran poll untuk semua container dan semua tab browser: list +
// inspect (restart count, waktu start) + stats container yang running.
@Injectable()
export class ContainersService implements OnApplicationBootstrap {
  private latest: ContainerSnapshot[] | null = null;
  private readonly updates = new Subject<ContainerSnapshot[]>();
  private polling: Promise<void> | null = null;

  constructor(
    private readonly docker: DockerService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.poll();
  }

  async getAll(): Promise<ContainerSnapshot[]> {
    if (!this.latest) await this.poll();
    return this.latest ?? [];
  }

  // Setiap hasil poll baru (untuk SSE /stream).
  get updates$(): Observable<ContainerSnapshot[]> {
    return this.updates.asObservable();
  }

  // Hasil poll terakhir tanpa menunggu (untuk evaluator alert).
  snapshot(): ContainerSnapshot[] {
    return this.latest ?? [];
  }

  @Interval(CONTAINERS_POLL_MS)
  poll(): Promise<void> {
    this.polling ??= this.collect().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async collect(): Promise<void> {
    try {
      const list = await this.docker.client.listContainers({ all: true });
      const results = await Promise.all(list.map((c) => this.describe(c)));
      this.latest = results
        .filter((c): c is ContainerSnapshot => c !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
      this.updates.next(this.latest);
    } catch (error) {
      this.logger.warn('containers.poll_failed', {
        error: (error as Error).message,
      });
    }
  }

  private async describe(
    summary: ContainerInfo,
  ): Promise<ContainerSnapshot | null> {
    const container = this.docker.client.getContainer(summary.Id);
    let inspect: ContainerInspectInfo;
    try {
      inspect = await container.inspect();
    } catch {
      // Terhapus di antara list dan inspect.
      return null;
    }

    const status = toContainerStatus(inspect.State.Status);
    let cpuPercent = 0;
    let memoryBytes = 0;
    if (status === 'running') {
      try {
        // stream=0 menunggu dua sampel → precpu terisi, CPU% akurat.
        const stats = (await container.stats({
          stream: false,
        })) as RawContainerStats;
        cpuPercent = cpuPercentFromStats(stats);
        memoryBytes = memoryFromStats(stats);
      } catch {
        // Container berhenti di tengah poll; nilai 0 untuk putaran ini.
      }
    }

    const { repo, tag } = splitImageRef(inspect.Config.Image);
    const startedAt =
      inspect.State.StartedAt && !inspect.State.StartedAt.startsWith('0001')
        ? inspect.State.StartedAt
        : null;

    return {
      id: summary.Id.slice(0, 12),
      name: inspect.Name.replace(/^\//, ''),
      image: repo,
      tag,
      status,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryBytes,
      restartCount: inspect.RestartCount ?? 0,
      startedAt,
      imageId: inspect.Image,
    };
  }
}

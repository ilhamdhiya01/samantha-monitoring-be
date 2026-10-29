import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Observable, Subject } from 'rxjs';
import { Logger } from 'winston';
import { DockerService } from '../docker/docker.service';
import type { SystemStatsDto } from './dto/system-stats.dto';
import { CpuSample, cpuPercentBetween, readHostSnapshot } from './host-stats';

export const SYSTEM_POLL_MS = 5_000;
const DOCKER_INFO_TTL_MS = 60_000;
// GET /system/df menghitung ukuran semua layer — mahal, cukup sesekali.
const DOCKER_DF_TTL_MS = 60_000;

interface DockerInfoCache {
  hostname: string;
  os: string;
  version: string;
  cores: number;
  fetchedAt: number;
}

interface DockerDf {
  LayersSize?: number;
  Containers?: { SizeRw?: number }[];
  Volumes?: { UsageData?: { Size?: number } }[];
  BuildCache?: { Size?: number }[];
}

// Resource VPS dipoll sekali tiap 5 detik untuk semua request (PRD: "stats
// dipoll sekali, bukan per request"). Controller dan alert disk membaca
// hasil terakhir.
@Injectable()
export class SystemService implements OnApplicationBootstrap {
  private latest: SystemStatsDto | null = null;
  private readonly updates = new Subject<SystemStatsDto>();
  private previousCpu: CpuSample | null = null;
  private info: DockerInfoCache | null = null;
  private dockerBytes = 0;
  private dfFetchedAt = 0;
  private polling: Promise<void> | null = null;

  constructor(
    private readonly docker: DockerService,
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.poll();
  }

  async getStats(): Promise<SystemStatsDto> {
    if (!this.latest) await this.poll();
    if (!this.latest) throw new Error('System stats belum tersedia');
    return this.latest;
  }

  // Setiap hasil poll baru (untuk SSE /stream).
  get updates$(): Observable<SystemStatsDto> {
    return this.updates.asObservable();
  }

  // Hasil poll terakhir tanpa menunggu.
  snapshot(): SystemStatsDto | null {
    return this.latest;
  }

  diskPercent(): number | null {
    if (!this.latest) return null;
    const { usedBytes, totalBytes } = this.latest.disk;
    return totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null;
  }

  hostname(): string {
    return this.info?.hostname ?? 'vps';
  }

  @Interval(SYSTEM_POLL_MS)
  poll(): Promise<void> {
    // Jangan menumpuk poll kalau satu putaran lambat.
    this.polling ??= this.collect().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async collect(): Promise<void> {
    try {
      const [snapshot, info] = await Promise.all([
        readHostSnapshot(
          this.configService.get<string>('host.procPath') ?? '/proc',
          this.configService.get<string>('host.rootPath') ?? '/',
        ),
        this.dockerInfo(),
      ]);
      void this.refreshDockerBytes();

      const cpuPercent = cpuPercentBetween(
        this.previousCpu,
        snapshot.cpuSample,
      );
      this.previousCpu = snapshot.cpuSample;

      this.latest = {
        hostname: info.hostname,
        ip: this.configService.get<string>('host.ip') || '—',
        os: info.os,
        dockerVersion: info.version,
        uptimeSec: snapshot.uptimeSec,
        cpu: {
          percent: Math.round(cpuPercent * 10) / 10,
          load1: snapshot.load1,
          cores: info.cores,
        },
        memory: snapshot.memory,
        disk: {
          mount: '/',
          usedBytes: snapshot.disk.usedBytes,
          totalBytes: snapshot.disk.totalBytes,
          dockerBytes: this.dockerBytes,
        },
      };
      this.updates.next(this.latest);
    } catch (error) {
      this.logger.warn('system.poll_failed', {
        error: (error as Error).message,
      });
    }
  }

  // Hostname, OS, versi dan jumlah core diambil dari Docker daemon — dari
  // dalam container, `os.hostname()` cuma id container.
  private async dockerInfo(): Promise<DockerInfoCache> {
    if (this.info && Date.now() - this.info.fetchedAt < DOCKER_INFO_TTL_MS) {
      return this.info;
    }
    const info = (await this.docker.client.info()) as {
      Name?: string;
      OperatingSystem?: string;
      ServerVersion?: string;
      NCPU?: number;
    };
    this.info = {
      hostname: info.Name ?? 'vps',
      os: info.OperatingSystem ?? 'Linux',
      version: info.ServerVersion ?? '?',
      cores: info.NCPU ?? 1,
      fetchedAt: Date.now(),
    };
    return this.info;
  }

  private async refreshDockerBytes(): Promise<void> {
    if (Date.now() - this.dfFetchedAt < DOCKER_DF_TTL_MS) return;
    this.dfFetchedAt = Date.now();
    try {
      const df = (await this.docker.client.df()) as DockerDf;
      const sum = (values: (number | undefined)[]) =>
        values.reduce<number>((total, value) => total + (value ?? 0), 0);
      this.dockerBytes =
        (df.LayersSize ?? 0) +
        sum((df.Containers ?? []).map((c) => c.SizeRw)) +
        sum((df.Volumes ?? []).map((v) => v.UsageData?.Size)) +
        sum((df.BuildCache ?? []).map((b) => b.Size));
    } catch (error) {
      this.logger.warn('system.df_failed', {
        error: (error as Error).message,
      });
    }
  }
}

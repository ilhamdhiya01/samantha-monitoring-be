import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Subscription } from 'rxjs';
import { Logger } from 'winston';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  Alert,
  AlertKind,
  AlertSeverity,
} from '../../generated/prisma/client';
import { ContainersService } from '../containers/containers.service';
import { DockerService } from '../docker/docker.service';
import type { DockerContainerEvent } from '../events/docker-event.types';
import { DockerEventsService } from '../events/docker-events.service';
import { ErrorCounterService } from '../metrics/error-counter.service';
import { SystemService } from '../system/system.service';
import { AlertsService } from './alerts.service';
import { TelegramService } from './telegram.service';

// `die` dalam rentang ini setelah `stop`/`kill` = disengaja (deploy,
// compose down), bukan crash.
export const DELIBERATE_STOP_MS = 10_000;
// Tunggu sebelum menyimpulkan container mati: restart policy biasanya
// menyalakannya lagi dalam hitungan detik (itu urusan restart loop).
export const EXIT_GRACE_MS = 15_000;
export const EVALUATE_MS = 60_000;

const MINUTE_MS = 60_000;

interface FireInput {
  kind: AlertKind;
  severity: AlertSeverity;
  container: string | null;
  title: string;
  description: string;
}

// Aturan alert PRD:
// - container exited     : `die` exit ≠ 0, bukan stop disengaja, tetap mati
// - restart loop         : > N kali `start` dalam M menit (dari event, bukan
//                          RestartCount yang reset saat recreate)
// - disk                 : > ALERT_DISK_PCT
// - error spike          : > ALERT_ERROR_COUNT error dalam 60 menit
// Satu alert aktif per (jenis, container); setelah selesai, cooldown
// ALERT_COOLDOWN_MIN sebelum jenis yang sama boleh dikirim lagi.
@Injectable()
export class AlertEvaluatorService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly lastStopAt = new Map<string, number>();
  private readonly lastExitCode = new Map<string, number>();
  private readonly startTimes = new Map<string, number[]>();
  private readonly exitTimers = new Set<NodeJS.Timeout>();
  private subscription: Subscription | undefined;

  private readonly diskPercent: number;
  private readonly restartCount: number;
  private readonly restartWindowMs: number;
  private readonly errorCount: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DockerEventsService,
    private readonly docker: DockerService,
    private readonly system: SystemService,
    private readonly containers: ContainersService,
    private readonly errorCounter: ErrorCounterService,
    private readonly telegram: TelegramService,
    private readonly alerts: AlertsService,
    configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    this.diskPercent = configService.get<number>('alert.diskPercent') ?? 80;
    this.restartCount = configService.get<number>('alert.restartCount') ?? 3;
    this.restartWindowMs =
      (configService.get<number>('alert.restartWindowMin') ?? 10) * MINUTE_MS;
    this.errorCount = configService.get<number>('alert.errorCount') ?? 10;
    this.cooldownMs =
      (configService.get<number>('alert.cooldownMin') ?? 30) * MINUTE_MS;
  }

  onApplicationBootstrap(): void {
    this.subscription = this.events.events$.subscribe((event) => {
      void this.handleEvent(event);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.exitTimers.forEach((timer) => clearTimeout(timer));
    this.exitTimers.clear();
  }

  async handleEvent(event: DockerContainerEvent): Promise<void> {
    const { action, name, time } = event;
    if (action === 'stop' || action === 'kill') {
      this.lastStopAt.set(name, time);
      return;
    }
    if (action === 'die') {
      const exitCode = event.exitCode ?? 0;
      this.lastExitCode.set(name, exitCode);
      const isDeliberate =
        time - (this.lastStopAt.get(name) ?? 0) < DELIBERATE_STOP_MS;
      if (exitCode !== 0 && !isDeliberate) {
        this.scheduleExitCheck(event.containerId, name, exitCode);
      }
      return;
    }
    if (action === 'start') {
      const starts = this.recentStarts(name, time);
      starts.push(time);
      this.startTimes.set(name, starts);
      if (starts.length > this.restartCount) {
        const exitCode = this.lastExitCode.get(name);
        await this.fire({
          kind: 'RESTART_LOOP',
          severity: 'CRITICAL',
          container: name,
          title: `${name} restart loop`,
          description:
            `${starts.length} kali start dalam ${this.restartWindowMs / MINUTE_MS} menit.` +
            (exitCode !== undefined ? ` Exit code terakhir: ${exitCode}.` : ''),
        });
      }
    }
  }

  @Interval(EVALUATE_MS)
  async evaluate(now = Date.now()): Promise<void> {
    try {
      await this.checkDisk();
      await this.checkErrorSpikes(now);
      await this.resolveFinished(now);
    } catch (error) {
      this.logger.warn('alerts.evaluate_failed', {
        error: (error as Error).message,
      });
    }
  }

  private scheduleExitCheck(id: string, name: string, exitCode: number) {
    const timer = setTimeout(() => {
      this.exitTimers.delete(timer);
      void this.confirmExit(id, name, exitCode);
    }, EXIT_GRACE_MS);
    this.exitTimers.add(timer);
  }

  async confirmExit(id: string, name: string, exitCode: number) {
    try {
      const info = await this.docker.client.getContainer(id).inspect();
      if (info.State.Running || info.State.Restarting) return;
    } catch {
      // Sudah dihapus (compose down/recreate) — bukan crash.
      return;
    }
    await this.fire({
      kind: 'CONTAINER_EXITED',
      severity: 'CRITICAL',
      container: name,
      title: `${name} berhenti`,
      description: `Exit code ${exitCode}, tidak jalan lagi setelah ${EXIT_GRACE_MS / 1000} detik.`,
    });
  }

  private async checkDisk(): Promise<void> {
    const percent = this.system.diskPercent();
    if (percent === null || percent <= this.diskPercent) return;
    await this.fire({
      kind: 'DISK_USAGE',
      severity: 'CRITICAL',
      container: null,
      title: `Disk / ${Math.round(percent)}% terpakai`,
      description: `Melewati ambang ${this.diskPercent}%. Cek image dangling di tabel Images.`,
    });
  }

  private async checkErrorSpikes(now: number): Promise<void> {
    const counts = this.errorCounter.errorsLastHour(now);
    for (const [container, count] of counts) {
      if (count <= this.errorCount) continue;
      await this.fire({
        kind: 'ERROR_SPIKE',
        severity: 'WARNING',
        container,
        title: `Error spike ${container}`,
        description: `${count} error dalam 60 menit terakhir.`,
      });
    }
  }

  // Alert selesai otomatis begitu kondisinya hilang.
  private async resolveFinished(now: number): Promise<void> {
    const active = await this.prisma.alert.findMany({
      where: { resolvedAt: null },
    });
    if (active.length === 0) return;

    const containers = new Map(
      this.containers.snapshot().map((c) => [c.name, c]),
    );
    const errors = this.errorCounter.errorsLastHour(now);
    const disk = this.system.diskPercent();

    for (const alert of active) {
      const container = alert.container
        ? containers.get(alert.container)
        : undefined;
      const isRunning = container?.status === 'running';
      let isOver = false;
      switch (alert.kind) {
        case 'DISK_USAGE':
          isOver = disk !== null && disk <= this.diskPercent;
          break;
        case 'ERROR_SPIKE':
          isOver = (errors.get(alert.container ?? '') ?? 0) <= this.errorCount;
          break;
        case 'RESTART_LOOP':
          isOver =
            isRunning &&
            this.recentStarts(alert.container ?? '', now).length <=
              this.restartCount;
          break;
        case 'CONTAINER_EXITED':
          isOver = isRunning;
          break;
      }
      if (isOver) await this.resolve(alert);
    }
  }

  private recentStarts(name: string, now: number): number[] {
    const cutoff = now - this.restartWindowMs;
    return (this.startTimes.get(name) ?? []).filter((time) => time > cutoff);
  }

  async fire(input: FireInput): Promise<Alert | null> {
    const last = await this.prisma.alert.findFirst({
      where: { kind: input.kind, container: input.container },
      orderBy: { firedAt: 'desc' },
    });
    // Masih aktif → kondisi yang sama, jangan kirim ulang.
    if (last && !last.resolvedAt) return null;
    if (last && Date.now() - last.firedAt.getTime() < this.cooldownMs) {
      return null;
    }

    const alert = await this.prisma.alert.create({ data: input });
    this.alerts.markChanged();
    this.logger.warn('alert.fired', {
      kind: input.kind,
      container: input.container,
      title: input.title,
    });
    const isSent = await this.telegram.send(
      `${input.severity === 'CRITICAL' ? '🔴' : '🟠'} ${input.title}\n` +
        `${input.description}\n` +
        `${this.system.hostname()} · ${new Date().toISOString().slice(11, 16)} UTC`,
    );
    if (isSent) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: { notifiedAt: new Date() },
      });
    }
    return alert;
  }

  private async resolve(alert: Alert): Promise<void> {
    await this.prisma.alert.update({
      where: { id: alert.id },
      data: { resolvedAt: new Date() },
    });
    this.alerts.markChanged();
    this.logger.info('alert.resolved', {
      kind: alert.kind,
      container: alert.container,
    });
    if (alert.notifiedAt) {
      await this.telegram.send(`✅ Pulih: ${alert.title}`);
    }
  }
}

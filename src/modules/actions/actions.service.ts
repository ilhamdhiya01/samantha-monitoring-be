import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContainersService } from '../containers/containers.service';
import { DockerService } from '../docker/docker.service';
import { ContainerActionKind, getActionBlocker } from './action-policy';
import type {
  ActionStatusDto,
  ContainerActionResultDto,
} from './dto/container-action.dto';

// Waktu tunggu SIGTERM sebelum SIGKILL, sama dengan default `docker stop`.
export const STOP_TIMEOUT_SEC = 10;

export interface ActionRequestMeta {
  ip?: string;
  userAgent?: string;
}

// Docker menjawab 304 kalau container sudah dalam kondisi tujuan.
const isNotModified = (error: unknown) =>
  (error as { statusCode?: number }).statusCode === 304;

@Injectable()
export class ActionsService {
  private readonly enabled: boolean;
  private readonly protectedProjects: string[];

  constructor(
    configService: ConfigService,
    private readonly docker: DockerService,
    private readonly containers: ContainersService,
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    this.enabled = configService.get<boolean>('actions.enabled') ?? false;
    this.protectedProjects =
      configService.get<string[]>('actions.protectedProjects') ?? [];
  }

  status(): ActionStatusDto {
    return {
      enabled: this.enabled && this.docker.actionClient !== null,
      disabledReason: getActionBlocker({
        enabled: this.enabled,
        hasClient: this.docker.actionClient !== null,
        protectedProjects: [],
        project: null,
        status: 'running',
      }),
      protectedProjects: this.protectedProjects,
    };
  }

  async run(
    name: string,
    action: ContainerActionKind,
    confirm: string,
    meta: ActionRequestMeta,
  ): Promise<ContainerActionResultDto> {
    if (confirm !== name) {
      throw new BadRequestException('Konfirmasi tidak cocok dengan nama');
    }
    const container = (await this.containers.getAll()).find(
      (item) => item.name === name,
    );
    if (!container) {
      throw new NotFoundException(`Container ${name} tidak ditemukan`);
    }
    const blocker = getActionBlocker({
      enabled: this.enabled,
      hasClient: this.docker.actionClient !== null,
      protectedProjects: this.protectedProjects,
      project: container.project,
      status: container.status,
    });
    const client = this.docker.actionClient;
    if (blocker || !client) {
      throw new ForbiddenException(blocker ?? 'Aksi tidak tersedia');
    }

    let error: string | null = null;
    try {
      const target = client.getContainer(container.id);
      if (action === 'stop') {
        await target.stop({ t: STOP_TIMEOUT_SEC });
      } else {
        await target.start();
      }
    } catch (caught) {
      if (!isNotModified(caught)) error = (caught as Error).message;
    }

    await this.audit(name, action, error, meta);
    // Status baru langsung ke semua tab lewat SSE /stream.
    void this.containers.poll();

    if (error) {
      throw new BadGatewayException(`Docker menolak ${action}: ${error}`);
    }
    return { container: name, action };
  }

  // Audit tidak boleh menggagalkan aksi yang sudah terjadi.
  private async audit(
    container: string,
    action: ContainerActionKind,
    error: string | null,
    meta: ActionRequestMeta,
  ): Promise<void> {
    this.logger.info('container.action', {
      container,
      action,
      ok: error === null,
      error,
      ip: meta.ip,
    });
    try {
      await this.prisma.containerAction.create({
        data: {
          action: action === 'stop' ? 'STOP' : 'START',
          container,
          ok: error === null,
          error,
          ip: meta.ip?.slice(0, 64) ?? null,
          userAgent: meta.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (caught) {
      this.logger.warn('container.action.audit_failed', {
        container,
        action,
        error: (caught as Error).message,
      });
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DockerService } from '../docker/docker.service';
import { DockerLogReader } from '../docker/log-stream';
import type { LogLineDto } from './dto/log-line.dto';
import { idToSinceSeconds, isAfterId, LogLineFactory } from './log-line';

// Batas baris yang dikirim ulang saat resume dari Last-Event-ID.
const RESUME_MAX_FACTOR = 4;

interface DockerError {
  statusCode?: number;
}

// Baris lama dari `docker logs` (bukan follow): tail saat stream dibuka,
// atau lanjutan setelah Last-Event-ID saat reconnect. Log tetap milik
// Docker; tidak ada salinan di memori atau database.
@Injectable()
export class LogHistoryService {
  constructor(
    private readonly docker: DockerService,
    private readonly configService: ConfigService,
  ) {}

  async assertExists(name: string): Promise<void> {
    try {
      await this.docker.client.getContainer(name).inspect();
    } catch (error) {
      if ((error as DockerError).statusCode === 404) {
        throw new NotFoundException(`Container ${name} tidak ditemukan`);
      }
      throw error;
    }
  }

  async history(name: string, afterId?: string): Promise<LogLineDto[]> {
    const tail = this.configService.get<number>('logs.tail') ?? 500;
    const container = this.docker.client.getContainer(name);
    const info = await container.inspect();
    const since = afterId ? idToSinceSeconds(afterId) : null;

    const buffer = await container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      timestamps: true,
      ...(since !== null
        ? { since, tail: tail * RESUME_MAX_FACTOR }
        : { tail }),
    });

    const reader = new DockerLogReader(info.Config.Tty);
    const factory = new LogLineFactory();
    const raws = [...reader.push(buffer), ...reader.flush()];
    return raws
      .map((raw) => factory.create(raw))
      .filter((line) => isAfterId(line.id, afterId));
  }
}

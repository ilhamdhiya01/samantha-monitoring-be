import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';

const fromHost = (host: string) => {
  const url = new URL(host.replace(/^tcp:/, 'http:'));
  return new Docker({
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    host: url.hostname,
    port: Number(url.port || 2375),
  });
};

// Satu-satunya pintu ke Docker Engine API. Produksi lewat
// docker-socket-proxy (DOCKER_HOST, POST=0) untuk semua pembacaan.
// Aksi stop/start lewat proxy kedua (DOCKER_ACTION_HOST) yang hanya
// mengizinkan dua endpoint itu — proxy baca tidak pernah diberi POST=1,
// karena bersama CONTAINERS=1 itu membuka /containers/create dan exec.
@Injectable()
export class DockerService {
  readonly client: Docker;
  // null = aksi tidak tersedia (produksi tanpa proxy aksi).
  readonly actionClient: Docker | null;

  constructor(configService: ConfigService) {
    const host = configService.get<string>('docker.host') ?? '';
    const actionHost = configService.get<string>('docker.actionHost') ?? '';
    this.client = host
      ? fromHost(host)
      : new Docker({
          socketPath: configService.get<string>('docker.socketPath'),
        });
    this.actionClient = actionHost
      ? fromHost(actionHost)
      : host
        ? null
        : this.client;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}

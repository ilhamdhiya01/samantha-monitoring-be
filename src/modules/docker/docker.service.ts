import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';

// Satu-satunya pintu ke Docker Engine API. Produksi lewat
// docker-socket-proxy (DOCKER_HOST, POST=0) — monitor tidak pernah butuh
// endpoint tulis di MVP.
@Injectable()
export class DockerService {
  readonly client: Docker;

  constructor(configService: ConfigService) {
    const host = configService.get<string>('docker.host') ?? '';
    if (host) {
      const url = new URL(host.replace(/^tcp:/, 'http:'));
      this.client = new Docker({
        protocol: url.protocol === 'https:' ? 'https' : 'http',
        host: url.hostname,
        port: Number(url.port || 2375),
      });
    } else {
      this.client = new Docker({
        socketPath: configService.get<string>('docker.socketPath'),
      });
    }
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

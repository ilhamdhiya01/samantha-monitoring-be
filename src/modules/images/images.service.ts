import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContainersService } from '../containers/containers.service';
import { DockerService } from '../docker/docker.service';
import type { ImageSummaryDto } from './dto/image.dto';
import { buildImageSummary, RawImage } from './image-state';

// PRD: refresh 30 detik — daftar image jarang berubah.
const CACHE_TTL_MS = 30_000;

@Injectable()
export class ImagesService {
  private cache: { value: ImageSummaryDto; at: number } | null = null;

  constructor(
    private readonly docker: DockerService,
    private readonly containers: ContainersService,
    private readonly prisma: PrismaService,
  ) {}

  async summary(): Promise<ImageSummaryDto> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.value;
    }
    const [images, containers, deploys] = await Promise.all([
      this.docker.client.listImages() as Promise<RawImage[]>,
      this.containers.getAll(),
      // Deploy terakhir per image (event `container create`).
      this.prisma.deployEvent.groupBy({
        by: ['imageId'],
        _max: { occurredAt: true },
      }),
    ]);

    const deployedAt = new Map<string, Date>();
    deploys.forEach((row) => {
      if (row._max.occurredAt) deployedAt.set(row.imageId, row._max.occurredAt);
    });

    const value = buildImageSummary(
      images,
      containers.map((c) => ({
        imageId: c.imageId,
        name: c.name,
        status: c.status,
      })),
      deployedAt,
    );
    this.cache = { value, at: Date.now() };
    return value;
  }
}

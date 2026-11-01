import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DeployEventDto, toDeployEventDto } from './dto/deploy-event.dto';

export const DEPLOY_HISTORY_LIMIT = 20;

@Injectable()
export class DeploysService {
  constructor(private readonly prisma: PrismaService) {}

  // Event `container create` terbaru, opsional untuk satu container.
  // Riwayat mulai sejak monitor dipasang (Docker tidak menyimpan event lama).
  async recent(container?: string): Promise<DeployEventDto[]> {
    const events = await this.prisma.deployEvent.findMany({
      where: container ? { container } : {},
      orderBy: { occurredAt: 'desc' },
      take: DEPLOY_HISTORY_LIMIT,
    });
    return events.map(toDeployEventDto);
  }
}

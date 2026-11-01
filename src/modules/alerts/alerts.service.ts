import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  AlertDto,
  AlertHistoryDto,
  toAlertDto,
  toAlertHistoryDto,
} from './dto/alert.dto';

export const ALERT_HISTORY_LIMIT = 50;

@Injectable()
export class AlertsService {
  private readonly changes = new Subject<void>();

  constructor(private readonly prisma: PrismaService) {}

  async active(): Promise<AlertDto[]> {
    const alerts = await this.prisma.alert.findMany({
      where: { resolvedAt: null },
      orderBy: { firedAt: 'desc' },
    });
    return alerts.map(toAlertDto);
  }

  // Aktif maupun selesai, terbaru dulu; opsional untuk satu container.
  // Disimpan 90 hari setelah selesai (retention).
  async history(container?: string): Promise<AlertHistoryDto[]> {
    const alerts = await this.prisma.alert.findMany({
      where: container ? { container } : {},
      orderBy: { firedAt: 'desc' },
      take: ALERT_HISTORY_LIMIT,
    });
    return alerts.map(toAlertHistoryDto);
  }

  // Dipanggil evaluator setiap alert muncul atau pulih; SSE /stream lalu
  // mengirim daftar aktif terbaru — tanpa menunggu poll FE.
  markChanged(): void {
    this.changes.next();
  }

  get changes$(): Observable<void> {
    return this.changes.asObservable();
  }
}

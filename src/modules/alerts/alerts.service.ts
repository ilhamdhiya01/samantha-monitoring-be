import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AlertDto, toAlertDto } from './dto/alert.dto';

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

  // Dipanggil evaluator setiap alert muncul atau pulih; SSE /stream lalu
  // mengirim daftar aktif terbaru — tanpa menunggu poll FE.
  markChanged(): void {
    this.changes.next();
  }

  get changes$(): Observable<void> {
    return this.changes.asObservable();
  }
}

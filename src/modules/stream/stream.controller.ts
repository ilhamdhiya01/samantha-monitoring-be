import { Controller, Header, MessageEvent, Sse } from '@nestjs/common';
import {
  concat,
  defer,
  EMPTY,
  from,
  interval,
  map,
  merge,
  Observable,
  of,
  switchMap,
} from 'rxjs';
import { AlertsService } from '../alerts/alerts.service';
import {
  ContainersService,
  toContainerDtos,
} from '../containers/containers.service';
import { SystemService } from '../system/system.service';

export const HEARTBEAT_MS = 15_000;
export const RECONNECT_MS = 3_000;

// GET /api/v1/stream — data dashboard selain log, satu koneksi per tab (PRD
// "Realtime: SSE"). Menggantikan polling FE untuk system, containers dan
// alert aktif:
//   stats      — SystemStatsDto, setiap poll host (5 dtk)
//   containers — ContainerDto[], setiap poll container (5 dtk)
//   alerts     — AlertDto[] (daftar aktif lengkap), saat alert muncul/pulih
//   ping       — heartbeat
// Saat tersambung (termasuk reconnect) kondisi terkini dikirim duluan, jadi
// FE tidak perlu refetch dan tidak ada event yang terlewat selama putus.
// Payload-nya data lengkap, bukan selisih: event boleh hilang tanpa membuat
// state FE salah.
@Controller('stream')
export class StreamController {
  constructor(
    private readonly system: SystemService,
    private readonly containers: ContainersService,
    private readonly alerts: AlertsService,
  ) {}

  @Sse()
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  stream(): Observable<MessageEvent> {
    return concat(this.snapshot(), this.live());
  }

  private snapshot(): Observable<MessageEvent> {
    const stats = this.system.snapshot();
    const containers = this.containers.snapshot();
    return concat(
      of<MessageEvent>({ type: 'ready', retry: RECONNECT_MS, data: {} }),
      stats ? of(this.statsEvent(stats)) : EMPTY,
      containers.length > 0 ? of(this.containersEvent(containers)) : EMPTY,
      defer(() => from(this.alerts.active())).pipe(map(this.alertsEvent)),
    );
  }

  private live(): Observable<MessageEvent> {
    return merge(
      this.system.updates$.pipe(map((stats) => this.statsEvent(stats))),
      this.containers.updates$.pipe(map((list) => this.containersEvent(list))),
      // switchMap: perubahan beruntun cukup mengirim daftar paling akhir.
      this.alerts.changes$.pipe(
        switchMap(() => from(this.alerts.active())),
        map(this.alertsEvent),
      ),
      interval(HEARTBEAT_MS).pipe(
        map((): MessageEvent => ({ type: 'ping', data: {} })),
      ),
    );
  }

  private statsEvent(
    stats: NonNullable<ReturnType<SystemService['snapshot']>>,
  ): MessageEvent {
    return { type: 'stats', data: stats };
  }

  private containersEvent(
    list: ReturnType<ContainersService['snapshot']>,
  ): MessageEvent {
    return { type: 'containers', data: toContainerDtos(list) };
  }

  private readonly alertsEvent = (
    alerts: Awaited<ReturnType<AlertsService['active']>>,
  ): MessageEvent => ({ type: 'alerts', data: alerts });
}

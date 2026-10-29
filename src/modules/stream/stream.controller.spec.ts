import type { MessageEvent } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import type { AlertsService } from '../alerts/alerts.service';
import type { AlertDto } from '../alerts/dto/alert.dto';
import type {
  ContainerSnapshot,
  ContainersService,
} from '../containers/containers.service';
import type { SystemStatsDto } from '../system/dto/system-stats.dto';
import type { SystemService } from '../system/system.service';
import { StreamController } from './stream.controller';

const stats = { hostname: 'vps-01' } as SystemStatsDto;
const container = {
  id: 'abc',
  name: 'tees-api',
  imageId: 'sha256:internal',
} as ContainerSnapshot;
const alert = { id: 'a1', kind: 'disk_usage' } as AlertDto;

const setup = (initial: { stats?: SystemStatsDto | null } = {}) => {
  const systemUpdates = new Subject<SystemStatsDto>();
  const containerUpdates = new Subject<ContainerSnapshot[]>();
  const alertChanges = new Subject<void>();
  const active = jest.fn().mockResolvedValue([alert]);

  const controller = new StreamController(
    {
      snapshot: () => (initial.stats === undefined ? stats : initial.stats),
      updates$: systemUpdates,
    } as unknown as SystemService,
    {
      snapshot: () => [container],
      updates$: containerUpdates,
    } as unknown as ContainersService,
    { active, changes$: alertChanges } as unknown as AlertsService,
  );

  const events: MessageEvent[] = [];
  const subscription: Subscription = controller
    .stream()
    .subscribe((event) => events.push(event));

  return {
    events,
    subscription,
    systemUpdates,
    containerUpdates,
    alertChanges,
    active,
  };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));
const types = (events: MessageEvent[]) => events.map((e) => e.type);

describe('StreamController', () => {
  it('sends the current state first, without internal fields', async () => {
    const { events, subscription } = setup();
    await flush();

    expect(types(events)).toEqual(['ready', 'stats', 'containers', 'alerts']);
    expect(events[1].data).toBe(stats);
    expect(events[2].data).toEqual([{ id: 'abc', name: 'tees-api' }]);
    expect(events[3].data).toEqual([alert]);
    subscription.unsubscribe();
  });

  it('skips stats that are not polled yet', async () => {
    const { events, subscription } = setup({ stats: null });
    await flush();

    expect(types(events)).toEqual(['ready', 'containers', 'alerts']);
    subscription.unsubscribe();
  });

  it('forwards poll results and alert changes', async () => {
    const {
      events,
      subscription,
      systemUpdates,
      containerUpdates,
      alertChanges,
      active,
    } = setup();
    await flush();
    events.length = 0;

    systemUpdates.next(stats);
    containerUpdates.next([container]);
    active.mockResolvedValueOnce([]);
    alertChanges.next();
    await flush();

    expect(types(events)).toEqual(['stats', 'containers', 'alerts']);
    expect(events[2].data).toEqual([]);
    subscription.unsubscribe();
  });

  it('stops listening when the client disconnects', async () => {
    const { subscription, systemUpdates } = setup();
    await flush();
    subscription.unsubscribe();

    expect(systemUpdates.observed).toBe(false);
  });
});

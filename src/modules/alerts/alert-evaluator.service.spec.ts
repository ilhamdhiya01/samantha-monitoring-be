import type { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';
import type { Logger } from 'winston';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Alert } from '../../generated/prisma/client';
import type { ContainersService } from '../containers/containers.service';
import type { DockerService } from '../docker/docker.service';
import type { DockerContainerEvent } from '../events/docker-event.types';
import type { DockerEventsService } from '../events/docker-events.service';
import type { ErrorCounterService } from '../metrics/error-counter.service';
import type { SystemService } from '../system/system.service';
import {
  AlertEvaluatorService,
  DELIBERATE_STOP_MS,
  EXIT_GRACE_MS,
} from './alert-evaluator.service';
import type { AlertsService } from './alerts.service';
import type { TelegramService } from './telegram.service';

const MINUTE = 60_000;

const alertRow = (overrides: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  kind: 'DISK_USAGE',
  severity: 'CRITICAL',
  container: null,
  title: 't',
  description: 'd',
  firedAt: new Date(),
  notifiedAt: null,
  resolvedAt: null,
  ...overrides,
});

const services: AlertEvaluatorService[] = [];

const setup = () => {
  const prisma = {
    alert: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Partial<Alert> }) =>
        Promise.resolve(alertRow(data)),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const inspect = jest.fn();
  const docker = {
    client: { getContainer: () => ({ inspect }) },
  };
  const system = {
    diskPercent: jest.fn().mockReturnValue(50),
    hostname: () => 'vps-01',
  };
  const containers = { snapshot: jest.fn().mockReturnValue([]) };
  const errorCounter = {
    errorsLastHour: jest.fn().mockReturnValue(new Map()),
  };
  const telegram = { send: jest.fn().mockResolvedValue(true) };
  const alerts = { markChanged: jest.fn() };
  const events = { events$: new Subject<DockerContainerEvent>() };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const settings: Record<string, number> = {
    'alert.diskPercent': 80,
    'alert.restartCount': 3,
    'alert.restartWindowMin': 10,
    'alert.errorCount': 10,
    'alert.cooldownMin': 30,
  };
  const config = {
    get: (key: string) => settings[key],
  } as unknown as ConfigService;

  const service = new AlertEvaluatorService(
    prisma as unknown as PrismaService,
    events as unknown as DockerEventsService,
    docker as unknown as DockerService,
    system as unknown as SystemService,
    containers as unknown as ContainersService,
    errorCounter as unknown as ErrorCounterService,
    telegram as unknown as TelegramService,
    alerts as unknown as AlertsService,
    config,
    logger as unknown as Logger,
  );
  services.push(service);
  return {
    service,
    prisma,
    inspect,
    system,
    containers,
    errorCounter,
    telegram,
  };
};

const event = (
  action: string,
  time: number,
  exitCode: number | null = null,
): DockerContainerEvent => ({
  action,
  containerId: 'abc',
  name: 'tees-worker',
  image: 'tees-worker:1.8.2',
  exitCode,
  time,
});

describe('AlertEvaluatorService', () => {
  afterEach(() => {
    // Bersihkan timer cek `die` yang masih menunggu.
    services.splice(0).forEach((service) => service.onModuleDestroy());
    jest.useRealTimers();
  });

  it('fires a restart loop after more than N starts in the window', async () => {
    const { service, prisma, telegram } = setup();
    const now = Date.now();
    await service.handleEvent(event('die', now, 1));
    for (let i = 0; i < 3; i += 1) {
      await service.handleEvent(event('start', now + i * MINUTE));
    }
    expect(prisma.alert.create).not.toHaveBeenCalled();

    await service.handleEvent(event('start', now + 3 * MINUTE));
    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'RESTART_LOOP',
        container: 'tees-worker',
        description: '4 kali start dalam 10 menit. Exit code terakhir: 1.',
      }) as unknown,
    });
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(prisma.alert.update).toHaveBeenCalled(); // notifiedAt
  });

  it('ignores starts older than the window', async () => {
    const { service, prisma } = setup();
    const now = Date.now();
    for (let i = 0; i < 4; i += 1) {
      await service.handleEvent(event('start', now + i * 11 * MINUTE));
    }
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('does not alert on a deliberate stop (deploy, compose down)', async () => {
    jest.useFakeTimers();
    const { service, prisma, inspect } = setup();
    inspect.mockResolvedValue({ State: { Running: false, Restarting: false } });
    const now = Date.now();

    await service.handleEvent(event('kill', now));
    await service.handleEvent(event('die', now + DELIBERATE_STOP_MS - 1, 137));
    await jest.advanceTimersByTimeAsync(EXIT_GRACE_MS + 1);

    expect(inspect).not.toHaveBeenCalled();
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('alerts when a crashed container stays down', async () => {
    jest.useFakeTimers();
    const { service, prisma, inspect } = setup();
    inspect.mockResolvedValue({ State: { Running: false, Restarting: false } });

    await service.handleEvent(event('die', Date.now(), 3));
    expect(prisma.alert.create).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(EXIT_GRACE_MS + 1);

    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'CONTAINER_EXITED',
      }) as unknown,
    });
  });

  it('does not alert when the restart policy brings it back', async () => {
    jest.useFakeTimers();
    const { service, prisma, inspect } = setup();
    inspect.mockResolvedValue({ State: { Running: true, Restarting: false } });

    await service.handleEvent(event('die', Date.now(), 1));
    await jest.advanceTimersByTimeAsync(EXIT_GRACE_MS + 1);
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('respects an active alert and the cooldown', async () => {
    const { service, prisma, telegram } = setup();
    const input = {
      kind: 'DISK_USAGE' as const,
      severity: 'CRITICAL' as const,
      container: null,
      title: 'Disk',
      description: 'penuh',
    };

    prisma.alert.findFirst.mockResolvedValueOnce(alertRow());
    expect(await service.fire(input)).toBeNull();

    prisma.alert.findFirst.mockResolvedValueOnce(
      alertRow({ resolvedAt: new Date(), firedAt: new Date() }),
    );
    expect(await service.fire(input)).toBeNull();

    prisma.alert.findFirst.mockResolvedValueOnce(
      alertRow({
        resolvedAt: new Date(),
        firedAt: new Date(Date.now() - 31 * MINUTE),
      }),
    );
    expect(await service.fire(input)).not.toBeNull();
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('fires disk and error spike alerts on evaluate', async () => {
    const { service, prisma, system, errorCounter } = setup();
    system.diskPercent.mockReturnValue(82.4);
    errorCounter.errorsLastHour.mockReturnValue(
      new Map([
        ['tees-api', 18],
        ['nginx', 4],
      ]),
    );

    await service.evaluate();

    const kinds = prisma.alert.create.mock.calls.map(
      ([arg]: [{ data: Alert }]) => [arg.data.kind, arg.data.container],
    );
    expect(kinds).toEqual([
      ['DISK_USAGE', null],
      ['ERROR_SPIKE', 'tees-api'],
    ]);
  });

  it('resolves alerts whose condition is gone and tells Telegram', async () => {
    const { service, prisma, containers, telegram } = setup();
    prisma.alert.findMany.mockResolvedValue([
      alertRow({ id: 'disk', notifiedAt: new Date() }),
      alertRow({
        id: 'exit',
        kind: 'CONTAINER_EXITED',
        container: 'tees-api',
      }),
      alertRow({
        id: 'still-down',
        kind: 'CONTAINER_EXITED',
        container: 'redis',
      }),
    ]);
    containers.snapshot.mockReturnValue([
      { name: 'tees-api', status: 'running' },
      { name: 'redis', status: 'exited' },
    ]);

    await service.evaluate();

    const resolved = prisma.alert.update.mock.calls.map(
      ([arg]: [{ where: { id: string } }]) => arg.where.id,
    );
    expect(resolved).toEqual(['disk', 'exit']);
    expect(telegram.send).toHaveBeenCalledWith('✅ Pulih: t');
  });
});

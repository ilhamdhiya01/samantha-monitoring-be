import { PassThrough } from 'stream';
import { Subject } from 'rxjs';
import type { Logger } from 'winston';
import type { DockerService } from '../docker/docker.service';
import type { DockerContainerEvent } from '../events/docker-event.types';
import type { DockerEventsService } from '../events/docker-events.service';
import type { ErrorCounterService } from '../metrics/error-counter.service';
import type { LogLineDto } from './dto/log-line.dto';
import {
  HEALTHY_STREAM_MS,
  LogIngestorService,
  RESUME_BACKOFF_MS,
} from './log-ingestor.service';

const line = (time: string, text: string) =>
  Buffer.from(`2026-10-29T${time}Z ${text}\n`);

const setup = () => {
  const streams: PassThrough[] = [];
  const logs = jest.fn(() => {
    const stream = new PassThrough();
    streams.push(stream);
    return Promise.resolve(stream);
  });
  const state = { Running: true };
  const inspect = jest.fn(() =>
    Promise.resolve({ Name: '/worker', Config: { Tty: true }, State: state }),
  );
  const docker = {
    client: {
      listContainers: () => Promise.resolve([{ Id: 'abc' }]),
      getContainer: () => ({ inspect, logs }),
    },
  };
  const record = jest.fn();
  const service = new LogIngestorService(
    docker as unknown as DockerService,
    {
      events$: new Subject<DockerContainerEvent>(),
    } as unknown as DockerEventsService,
    { record } as unknown as ErrorCounterService,
    { info: jest.fn(), warn: jest.fn() } as unknown as Logger,
  );
  const received: LogLineDto[] = [];
  service.lines$('worker').subscribe((l) => received.push(l));
  return { service, streams, logs, state, record, received };
};

describe('LogIngestorService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('resumes a running container after the proxy drops an idle stream', async () => {
    const { service, streams, logs, received, record } = setup();
    await service.onApplicationBootstrap();
    expect(logs).toHaveBeenCalledTimes(1);

    streams[0].write(line('10:00:01.000000000', 'first'));
    streams[0].end();
    await jest.advanceTimersByTimeAsync(RESUME_BACKOFF_MS[0] + 1);

    expect(logs).toHaveBeenCalledTimes(2);
    expect(logs.mock.calls[1]).toEqual([
      expect.objectContaining({
        since: Date.UTC(2026, 9, 29, 10, 0, 1) / 1000,
      }),
    ]);

    // `since` berdetik → Docker mengirim ulang baris yang sudah diproses.
    streams[1].write(line('10:00:01.000000000', 'first'));
    streams[1].write(line('10:00:02.000000000', 'ERROR second'));
    await jest.advanceTimersByTimeAsync(0);

    expect(received.map((l) => l.text)).toEqual(['first', 'ERROR second']);
    expect(record).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it('does not resume a container that really stopped', async () => {
    const { service, streams, logs, state } = setup();
    await service.onApplicationBootstrap();

    state.Running = false;
    streams[0].end();
    await jest.advanceTimersByTimeAsync(RESUME_BACKOFF_MS[0] + 1);

    expect(logs).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('resumes a quiet container quickly after a long idle stream', async () => {
    const { service, streams, logs } = setup();
    await service.onApplicationBootstrap();

    // Tidak ada baris selama 10 menit, lalu proxy memutus.
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    streams[0].end();
    await jest.advanceTimersByTimeAsync(RESUME_BACKOFF_MS[0] + 1);

    expect(logs).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it('backs off when a stream keeps closing right away', async () => {
    const { service, streams, logs } = setup();
    await service.onApplicationBootstrap();

    streams[0].end();
    await jest.advanceTimersByTimeAsync(RESUME_BACKOFF_MS[1] - 1);
    expect(logs).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2);
    expect(logs).toHaveBeenCalledTimes(2);

    streams[1].end();
    await jest.advanceTimersByTimeAsync(RESUME_BACKOFF_MS[2] - 1);
    expect(logs).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2);
    expect(logs).toHaveBeenCalledTimes(3);
    expect(HEALTHY_STREAM_MS).toBeGreaterThan(RESUME_BACKOFF_MS[2]);
    service.onModuleDestroy();
  });

  it('stops resuming after shutdown', async () => {
    const { service, streams, logs } = setup();
    await service.onApplicationBootstrap();

    streams[0].end();
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(RESUME_BACKOFF_MS[0] + 1);

    expect(logs).toHaveBeenCalledTimes(1);
  });
});

import {
  cpuPercentFromStats,
  memoryFromStats,
  splitImageRef,
  toContainerStatus,
} from './container-stats';

describe('container-stats', () => {
  it('computes CPU% like `docker stats`', () => {
    expect(
      cpuPercentFromStats({
        cpu_stats: {
          cpu_usage: { total_usage: 2_000 },
          system_cpu_usage: 20_000,
          online_cpus: 2,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 1_000 },
          system_cpu_usage: 10_000,
        },
      }),
    ).toBe(20);
    expect(cpuPercentFromStats({})).toBe(0);
  });

  it('subtracts page cache from memory usage', () => {
    expect(
      memoryFromStats({
        memory_stats: { usage: 500, stats: { inactive_file: 200 } },
      }),
    ).toBe(300);
  });

  it('splits image references', () => {
    expect(splitImageRef('nginx:1.27-alpine')).toEqual({
      repo: 'nginx',
      tag: '1.27-alpine',
    });
    expect(splitImageRef('localhost:5000/tees-api')).toEqual({
      repo: 'localhost:5000/tees-api',
      tag: 'latest',
    });
    expect(splitImageRef('ghcr.io/org/api:1.8.2@sha256:abc')).toEqual({
      repo: 'ghcr.io/org/api',
      tag: '1.8.2',
    });
  });

  it('maps Docker states', () => {
    expect(toContainerStatus('running')).toBe('running');
    expect(toContainerStatus('removing')).toBe('dead');
  });
});

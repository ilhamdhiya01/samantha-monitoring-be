import type { ContainerStatus } from './dto/container.dto';

// Subset respons GET /containers/{id}/stats?stream=0.
export interface RawContainerStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    stats?: Record<string, number>;
  };
}

// Rumus yang sama dengan `docker stats`.
export const cpuPercentFromStats = (stats: RawContainerStats): number => {
  const cpu = stats.cpu_stats;
  const pre = stats.precpu_stats;
  const cpuDelta =
    (cpu?.cpu_usage?.total_usage ?? 0) - (pre?.cpu_usage?.total_usage ?? 0);
  const systemDelta =
    (cpu?.system_cpu_usage ?? 0) - (pre?.system_cpu_usage ?? 0);
  const cpus = cpu?.online_cpus || cpu?.cpu_usage?.percpu_usage?.length || 1;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return (cpuDelta / systemDelta) * cpus * 100;
};

// Seperti `docker stats`: page cache tidak dihitung (cgroup v2:
// inactive_file, v1: total_inactive_file / cache).
export const memoryFromStats = (stats: RawContainerStats): number => {
  const memory = stats.memory_stats;
  const usage = memory?.usage ?? 0;
  const extra = memory?.stats ?? {};
  const cache =
    extra.inactive_file ?? extra.total_inactive_file ?? extra.cache ?? 0;
  return Math.max(0, usage - cache);
};

const STATUSES: ContainerStatus[] = [
  'running',
  'restarting',
  'exited',
  'paused',
  'created',
  'dead',
];

export const toContainerStatus = (state: string): ContainerStatus =>
  STATUSES.includes(state as ContainerStatus)
    ? (state as ContainerStatus)
    : state === 'removing'
      ? 'dead'
      : 'exited';

// "ghcr.io/org/api:1.8.2" → ["ghcr.io/org/api", "1.8.2"]; titik dua milik
// port registry ("localhost:5000/api") bukan tag.
export const splitImageRef = (ref: string): { repo: string; tag: string } => {
  const withoutDigest = ref.split('@')[0];
  const colon = withoutDigest.lastIndexOf(':');
  if (colon > withoutDigest.lastIndexOf('/')) {
    return {
      repo: withoutDigest.slice(0, colon),
      tag: withoutDigest.slice(colon + 1),
    };
  }
  if (/^sha256:/.test(ref)) return { repo: ref.slice(7, 19), tag: '' };
  return { repo: withoutDigest, tag: 'latest' };
};

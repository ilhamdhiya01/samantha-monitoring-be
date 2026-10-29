import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

// Pembacaan resource host. Di produksi /proc dan / milik host di-mount
// read-only ke container monitor (HOST_PROC, HOST_ROOT); tanpa itu
// container cuma melihat dirinya sendiri. Di Mac (dev) /proc tidak ada,
// jadi jatuh ke modul `os`.

export interface CpuSample {
  idle: number;
  total: number;
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  swapUsedBytes: number;
}

// Baris pertama /proc/stat: "cpu  user nice system idle iowait irq …"
export const parseProcStat = (content: string): CpuSample | null => {
  const line = content.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  // idle + iowait
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
};

export const cpuPercentBetween = (
  previous: CpuSample | null,
  current: CpuSample,
): number => {
  if (!previous) return 0;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((total - idle) / total) * 100));
};

// Nilai /proc/meminfo dalam kB.
export const parseMeminfo = (content: string): MemoryInfo => {
  const values = new Map<string, number>();
  content.split('\n').forEach((line) => {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  });
  const total = values.get('MemTotal') ?? 0;
  const available =
    values.get('MemAvailable') ??
    (values.get('MemFree') ?? 0) +
      (values.get('Buffers') ?? 0) +
      (values.get('Cached') ?? 0);
  return {
    totalBytes: total,
    usedBytes: Math.max(0, total - available),
    swapUsedBytes: Math.max(
      0,
      (values.get('SwapTotal') ?? 0) - (values.get('SwapFree') ?? 0),
    ),
  };
};

const readText = async (file: string) => {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
};

const osCpuSample = (): CpuSample =>
  os.cpus().reduce(
    (sample, cpu) => {
      const { user, nice, sys, idle, irq } = cpu.times;
      return {
        idle: sample.idle + idle,
        total: sample.total + user + nice + sys + idle + irq,
      };
    },
    { idle: 0, total: 0 },
  );

export interface HostSnapshot {
  cpuSample: CpuSample;
  load1: number;
  uptimeSec: number;
  memory: MemoryInfo;
  disk: { usedBytes: number; totalBytes: number };
}

export const readHostSnapshot = async (
  procPath: string,
  rootPath: string,
): Promise<HostSnapshot> => {
  const [stat, loadavg, uptime, meminfo, fsStats] = await Promise.all([
    readText(path.join(procPath, 'stat')),
    readText(path.join(procPath, 'loadavg')),
    readText(path.join(procPath, 'uptime')),
    readText(path.join(procPath, 'meminfo')),
    fs.statfs(rootPath),
  ]);

  const memory = meminfo
    ? parseMeminfo(meminfo)
    : {
        totalBytes: os.totalmem(),
        usedBytes: os.totalmem() - os.freemem(),
        swapUsedBytes: 0,
      };

  return {
    cpuSample: (stat && parseProcStat(stat)) || osCpuSample(),
    load1: loadavg ? Number(loadavg.split(' ')[0]) : os.loadavg()[0],
    uptimeSec: uptime ? Math.floor(Number(uptime.split(' ')[0])) : os.uptime(),
    memory,
    // Seperti `df`: terpakai = total - bebas; tersedia untuk user = bavail.
    disk: {
      totalBytes: fsStats.blocks * fsStats.bsize,
      usedBytes: (fsStats.blocks - fsStats.bfree) * fsStats.bsize,
    },
  };
};

// Kontrak dengan FE (dashboard-monitoring-fe/src/lib/types/system.types.ts).
export interface SystemStatsDto {
  hostname: string;
  ip: string;
  os: string;
  dockerVersion: string;
  uptimeSec: number;
  cpu: { percent: number; load1: number; cores: number };
  memory: { usedBytes: number; totalBytes: number; swapUsedBytes: number };
  disk: {
    mount: string;
    usedBytes: number;
    totalBytes: number;
    dockerBytes: number;
  };
}

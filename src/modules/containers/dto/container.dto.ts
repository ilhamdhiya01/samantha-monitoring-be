export type ContainerStatus =
  'running' | 'restarting' | 'exited' | 'paused' | 'created' | 'dead';

// Kontrak dengan FE (container.types.ts).
export interface ContainerDto {
  id: string;
  name: string;
  image: string;
  tag: string;
  status: ContainerStatus;
  cpuPercent: number;
  memoryBytes: number;
  restartCount: number;
  startedAt: string | null;
  // Exit code terakhir untuk container yang berhenti; null kalau masih
  // jalan. Exit 0 = selesai normal (mis. job migrate), bukan masalah.
  exitCode: number | null;
}

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
}

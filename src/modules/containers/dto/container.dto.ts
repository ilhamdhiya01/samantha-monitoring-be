export type ContainerStatus =
  'running' | 'restarting' | 'exited' | 'paused' | 'created' | 'dead';

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting';

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
  // Label docker compose; null untuk container yang dibuat di luar compose
  // (`docker run`). FE mengelompokkan sidebar per project.
  project: string | null;
  service: string | null;
  // Hasil healthcheck; null kalau container tidak punya healthcheck.
  health: ContainerHealth | null;
  // Mati karena kehabisan memori. Exit 137 bisa OOM atau `docker kill`;
  // hanya flag ini yang membedakan.
  oomKilled: boolean;
  // ISO, terakhir kali berhenti; null kalau belum pernah berhenti.
  finishedAt: string | null;
  // "no" | "always" | "unless-stopped" | "on-failure".
  restartPolicy: string;
}

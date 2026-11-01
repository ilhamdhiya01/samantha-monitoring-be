import type { ContainerStatus } from '../containers/dto/container.dto';

export type ContainerActionKind = 'stop' | 'start';

export interface ActionContext {
  enabled: boolean;
  hasClient: boolean;
  protectedProjects: string[];
  project: string | null;
  status: ContainerStatus;
}

// Alasan aksi ditolak (untuk FE dan respons 403), atau null kalau boleh.
// Status tidak cocok (stop container yang sudah mati) bukan penolakan:
// Docker menjawab 304 dan aksi dianggap selesai.
export const getActionBlocker = (ctx: ActionContext): string | null => {
  if (!ctx.enabled) return 'Aksi dimatikan (ACTIONS_ENABLED=false)';
  if (!ctx.hasClient) {
    return 'Proxy aksi belum dipasang (DOCKER_ACTION_HOST kosong)';
  }
  if (ctx.project && ctx.protectedProjects.includes(ctx.project)) {
    return 'Container milik monitor sendiri tidak bisa dihentikan dari sini';
  }
  return null;
};

export const canStop = (status: ContainerStatus) =>
  status === 'running' || status === 'restarting' || status === 'paused';

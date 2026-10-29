import type { ContainerStatus } from '../../containers/dto/container.dto';

// active   — dipakai container
// previous — versi lain dari repo yang sedang dipakai (kandidat rollback)
// unused   — ber-tag, repo-nya tidak dipakai container mana pun
// dangling — tanpa tag (<none>), kandidat prune
export type ImageState = 'active' | 'previous' | 'unused' | 'dangling';

// Kontrak dengan FE (image.types.ts).
export interface ImageDto {
  id: string;
  repository: string;
  tag: string | null;
  sizeBytes: number;
  createdAt: string;
  deployedAt: string | null;
  state: ImageState;
  usedBy: { name: string; status: ContainerStatus; exitCode: number | null }[];
}

export interface ImageSummaryDto {
  images: ImageDto[];
  totalCount: number;
  totalBytes: number;
  danglingCount: number;
  danglingBytes: number;
}

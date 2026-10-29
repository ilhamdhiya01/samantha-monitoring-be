import type { ContainerStatus } from '../../containers/dto/container.dto';

export type ImageState = 'active' | 'previous' | 'dangling';

// Kontrak dengan FE (image.types.ts).
export interface ImageDto {
  id: string;
  repository: string;
  tag: string | null;
  sizeBytes: number;
  createdAt: string;
  deployedAt: string | null;
  state: ImageState;
  usedBy: { name: string; status: ContainerStatus }[];
}

export interface ImageSummaryDto {
  images: ImageDto[];
  totalCount: number;
  totalBytes: number;
  danglingCount: number;
  danglingBytes: number;
}

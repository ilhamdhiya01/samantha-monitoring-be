import type { ContainerStatus } from '../containers/dto/container.dto';
import { splitImageRef } from '../containers/container-stats';
import type { ImageDto, ImageSummaryDto } from './dto/image.dto';

// Subset GET /images/json.
export interface RawImage {
  Id: string;
  RepoTags?: string[] | null;
  RepoDigests?: string[] | null;
  Size: number;
  Created: number;
}

export interface ImageUser {
  imageId: string;
  name: string;
  status: ContainerStatus;
}

const NONE = '<none>:<none>';

// Satu baris per tag. Status:
// - active   — dipakai container (apa pun statusnya)
// - previous — ber-tag tapi tidak dipakai (kandidat rollback v1.1)
// - dangling — tanpa tag (<none>), kandidat prune
export const buildImageSummary = (
  images: RawImage[],
  users: ImageUser[],
  deployedAt: Map<string, Date>,
): ImageSummaryDto => {
  const usersByImage = new Map<string, ImageUser[]>();
  users.forEach((user) => {
    const list = usersByImage.get(user.imageId) ?? [];
    list.push(user);
    usersByImage.set(user.imageId, list);
  });

  let danglingCount = 0;
  let danglingBytes = 0;
  const rows: ImageDto[] = [];

  images.forEach((image) => {
    const tags = (image.RepoTags ?? []).filter((tag) => tag !== NONE);
    const usedBy = (usersByImage.get(image.Id) ?? []).map(
      ({ name, status }) => ({ name, status }),
    );
    const base = {
      id: image.Id,
      sizeBytes: image.Size,
      createdAt: new Date(image.Created * 1000).toISOString(),
      deployedAt: deployedAt.get(image.Id)?.toISOString() ?? null,
      usedBy,
    };

    if (tags.length === 0) {
      danglingCount += 1;
      danglingBytes += image.Size;
      const digest = image.RepoDigests?.[0];
      rows.push({
        ...base,
        repository: digest ? digest.split('@')[0] : '<none>',
        tag: null,
        state: usedBy.length > 0 ? 'active' : 'dangling',
      });
      return;
    }

    tags.forEach((ref) => {
      const { repo, tag } = splitImageRef(ref);
      rows.push({
        ...base,
        repository: repo,
        tag,
        state: usedBy.length > 0 ? 'active' : 'previous',
      });
    });
  });

  return {
    images: rows,
    totalCount: images.length,
    totalBytes: images.reduce((sum, image) => sum + image.Size, 0),
    danglingCount,
    danglingBytes,
  };
};

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
  exitCode: number | null;
  createdAt: string;
}

const NONE = '<none>:<none>';

const latest = (dates: (string | undefined)[]) =>
  dates
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1) ?? null;

// Satu baris per tag; status lihat ImageState. `deployedAt` dari event
// `container create` yang dicatat monitor; kalau belum ada (container dibuat
// sebelum monitor dipasang), pakai waktu dibuatnya container pemakai.
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
    const users = usersByImage.get(image.Id) ?? [];
    const usedBy = users.map(({ name, status, exitCode }) => ({
      name,
      status,
      exitCode,
    }));
    const base = {
      id: image.Id,
      sizeBytes: image.Size,
      createdAt: new Date(image.Created * 1000).toISOString(),
      deployedAt:
        deployedAt.get(image.Id)?.toISOString() ??
        latest(users.map((user) => user.createdAt)),
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
        state: usedBy.length > 0 ? 'active' : 'unused',
      });
    });
  });

  // Ber-tag tapi tidak dipakai = "previous" hanya kalau repo yang sama
  // sedang dipakai versi lain; selain itu sekadar image yang tidak terpakai
  // (mis. alpine hasil `docker run` sekali).
  const activeRepos = new Set(
    rows.filter((row) => row.state === 'active').map((row) => row.repository),
  );
  rows.forEach((row) => {
    if (row.state === 'unused' && activeRepos.has(row.repository)) {
      row.state = 'previous';
    }
  });

  return {
    images: rows,
    totalCount: images.length,
    totalBytes: images.reduce((sum, image) => sum + image.Size, 0),
    danglingCount,
    danglingBytes,
  };
};

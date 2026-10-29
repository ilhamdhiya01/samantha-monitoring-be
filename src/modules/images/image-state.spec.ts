import { buildImageSummary, ImageUser, RawImage } from './image-state';

const image = (id: string, tags: string[] | null, size = 100): RawImage => ({
  Id: id,
  RepoTags: tags,
  Size: size,
  Created: 1_700_000_000,
});

const user = (
  imageId: string,
  name: string,
  overrides: Partial<ImageUser> = {},
): ImageUser => ({
  imageId,
  name,
  status: 'running',
  exitCode: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  ...overrides,
});

describe('buildImageSummary', () => {
  it('classifies active, previous and dangling images', () => {
    const summary = buildImageSummary(
      [
        image('sha256:new', ['tees-api:1.8.2']),
        image('sha256:old', ['tees-api:1.8.1']),
        image('sha256:none', ['<none>:<none>'], 50),
      ],
      [user('sha256:new', 'tees-api')],
      new Map([['sha256:new', new Date('2026-10-28T21:14:00Z')]]),
    );

    expect(
      summary.images.map((i) => [i.repository, i.tag, i.state, i.deployedAt]),
    ).toEqual([
      ['tees-api', '1.8.2', 'active', '2026-10-28T21:14:00.000Z'],
      ['tees-api', '1.8.1', 'previous', null],
      ['<none>', null, 'dangling', null],
    ]);
    expect(summary.images[0].usedBy).toEqual([
      { name: 'tees-api', status: 'running', exitCode: null },
    ]);
    expect(summary).toMatchObject({
      totalCount: 3,
      totalBytes: 250,
      danglingCount: 1,
      danglingBytes: 50,
    });
  });

  it('emits one row per tag of a multi-tagged image', () => {
    const summary = buildImageSummary(
      [image('sha256:x', ['api:1.0', 'api:latest'])],
      [],
      new Map(),
    );
    expect(summary.images.map((i) => i.tag)).toEqual(['1.0', 'latest']);
    expect(summary.totalCount).toBe(1);
  });

  it('marks unused tags as previous only when their repo is in use', () => {
    const summary = buildImageSummary(
      [
        image('sha256:api2', ['api:2']),
        image('sha256:api1', ['api:1']),
        image('sha256:alpine', ['alpine:latest']),
      ],
      [user('sha256:api2', 'api')],
      new Map(),
    );
    expect(summary.images.map((i) => [i.tag, i.state])).toEqual([
      ['2', 'active'],
      ['1', 'previous'],
      ['latest', 'unused'],
    ]);
  });

  it('falls back to the newest container creation time as deploy time', () => {
    const summary = buildImageSummary(
      [image('sha256:db', ['postgres:16'])],
      [
        user('sha256:db', 'a-db', { createdAt: '2026-10-01T00:00:00.000Z' }),
        user('sha256:db', 'b-db', { createdAt: '2026-10-27T09:30:00.000Z' }),
      ],
      new Map(),
    );
    expect(summary.images[0].deployedAt).toBe('2026-10-27T09:30:00.000Z');
  });

  it('keeps the exit code of finished containers', () => {
    const summary = buildImageSummary(
      [image('sha256:mig', ['api:latest-migrator'])],
      [user('sha256:mig', 'api-migrate', { status: 'exited', exitCode: 0 })],
      new Map(),
    );
    expect(summary.images[0].usedBy).toEqual([
      { name: 'api-migrate', status: 'exited', exitCode: 0 },
    ]);
  });
});

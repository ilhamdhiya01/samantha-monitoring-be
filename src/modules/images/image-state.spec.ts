import { buildImageSummary, RawImage } from './image-state';

const image = (id: string, tags: string[] | null, size = 100): RawImage => ({
  Id: id,
  RepoTags: tags,
  Size: size,
  Created: 1_700_000_000,
});

describe('buildImageSummary', () => {
  it('classifies active, previous and dangling images', () => {
    const summary = buildImageSummary(
      [
        image('sha256:new', ['tees-api:1.8.2']),
        image('sha256:old', ['tees-api:1.8.1']),
        image('sha256:none', ['<none>:<none>'], 50),
      ],
      [{ imageId: 'sha256:new', name: 'tees-api', status: 'running' }],
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
      { name: 'tees-api', status: 'running' },
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
});

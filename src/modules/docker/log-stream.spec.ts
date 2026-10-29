import {
  DockerDemuxer,
  DockerLogReader,
  LineSplitter,
  splitTimestamp,
} from './log-stream';

const frame = (stream: 1 | 2, text: string) => {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(stream, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

describe('DockerDemuxer', () => {
  it('unpacks stdout and stderr frames', () => {
    const demuxer = new DockerDemuxer();
    const payloads = demuxer.push(
      Buffer.concat([frame(1, 'out\n'), frame(2, 'err\n')]),
    );
    expect(payloads.map((p) => p.toString())).toEqual(['out\n', 'err\n']);
  });

  it('waits for a frame split across chunks, header included', () => {
    const demuxer = new DockerDemuxer();
    const whole = frame(1, 'hello world\n');
    expect(demuxer.push(whole.subarray(0, 5))).toEqual([]);
    expect(demuxer.push(whole.subarray(5, 12))).toEqual([]);
    expect(demuxer.push(whole.subarray(12)).map(String)).toEqual([
      'hello world\n',
    ]);
  });
});

describe('LineSplitter', () => {
  it('keeps a partial line until its newline arrives', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('a\nb')).toEqual(['a']);
    expect(splitter.push('c\r\n\nd')).toEqual(['bc']);
    expect(splitter.flush()).toEqual(['d']);
    expect(splitter.flush()).toEqual([]);
  });
});

describe('splitTimestamp', () => {
  it('normalises the fraction to 9 digits', () => {
    expect(splitTimestamp('2026-10-29T10:42:01.2212Z GET /')).toEqual({
      timestamp: '2026-10-29T10:42:01.221200000Z',
      text: 'GET /',
    });
  });

  it('rejects lines without a timestamp', () => {
    expect(splitTimestamp('no timestamp')).toBeNull();
  });
});

describe('DockerLogReader', () => {
  it('reads multiplexed output into timestamped lines', () => {
    const reader = new DockerLogReader(false);
    const lines = reader.push(
      Buffer.concat([
        frame(1, '2026-10-29T10:00:00.1Z first\n2026-10-29T10:00:00.2Z sec'),
        frame(1, 'ond\n'),
      ]),
    );
    expect(lines.map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('reads raw TTY output without demuxing', () => {
    const reader = new DockerLogReader(true);
    expect(
      reader.push(Buffer.from('2026-10-29T10:00:00Z tty line\n'))[0].text,
    ).toBe('tty line');
  });
});

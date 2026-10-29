// Utilitas stream log Docker: membongkar frame multiplex dan memotong
// per baris. Fungsi murni, tanpa I/O — dites di log-stream.spec.ts.

const HEADER_SIZE = 8;

// Container tanpa TTY mengirim stdout/stderr dalam frame:
// [stream(1) 0 0 0 size(uint32 BE)] + payload. Header bisa terpotong di
// antara dua chunk, jadi sisa byte disimpan sampai frame lengkap.
export class DockerDemuxer {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const payloads: Buffer[] = [];

    while (this.pending.length >= HEADER_SIZE) {
      const size = this.pending.readUInt32BE(4);
      if (this.pending.length < HEADER_SIZE + size) break;
      payloads.push(this.pending.subarray(HEADER_SIZE, HEADER_SIZE + size));
      this.pending = this.pending.subarray(HEADER_SIZE + size);
    }
    return payloads;
  }
}

// Payload bisa berisi setengah baris; potongan terakhir disimpan sampai
// newline berikutnya datang.
export class LineSplitter {
  private rest = '';

  push(text: string): string[] {
    const parts = (this.rest + text).split('\n');
    this.rest = parts.pop() ?? '';
    return parts.map((line) => line.replace(/\r$/, '')).filter(Boolean);
  }

  flush(): string[] {
    const last = this.rest.replace(/\r$/, '');
    this.rest = '';
    return last ? [last] : [];
  }
}

export interface RawLogLine {
  // RFC3339Nano dari Docker, pecahan dinormalkan ke 9 digit.
  timestamp: string;
  text: string;
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z\s?/;

// `docker logs --timestamps` menaruh waktu di depan setiap baris.
export const splitTimestamp = (line: string): RawLogLine | null => {
  const match = TIMESTAMP.exec(line);
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(9, '0');
  return {
    timestamp: `${match[1]}.${fraction}Z`,
    text: line.slice(match[0].length),
  };
};

// Pembaca lengkap satu stream log: demux (kalau bukan TTY) → baris →
// timestamp. Dipakai untuk follow (chunk demi chunk) dan untuk buffer
// hasil `docker logs` biasa.
export class DockerLogReader {
  private readonly demuxer: DockerDemuxer | null;
  private readonly splitter = new LineSplitter();

  constructor(isTty: boolean) {
    this.demuxer = isTty ? null : new DockerDemuxer();
  }

  push(chunk: Buffer): RawLogLine[] {
    const payloads = this.demuxer ? this.demuxer.push(chunk) : [chunk];
    return payloads
      .flatMap((payload) => this.splitter.push(payload.toString('utf8')))
      .map(splitTimestamp)
      .filter((line): line is RawLogLine => line !== null);
  }

  flush(): RawLogLine[] {
    return this.splitter
      .flush()
      .map(splitTimestamp)
      .filter((line): line is RawLogLine => line !== null);
  }
}

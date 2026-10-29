import type { RawLogLine } from '../docker/log-stream';
import type { LogLineDto } from './dto/log-line.dto';
import { detectLogLevel } from './log-parser';

// Membuat LogLineDto dari baris mentah Docker. Baris dengan timestamp
// sama persis diberi nomor urut (#1, #2, …) supaya id tetap unik; urutan
// itu konsisten antara ingest live dan `docker logs` karena Docker
// mengirimnya dalam urutan yang sama.
export class LogLineFactory {
  private lastTimestamp = '';
  private sequence = 0;

  create(raw: RawLogLine): LogLineDto {
    if (raw.timestamp === this.lastTimestamp) {
      this.sequence += 1;
    } else {
      this.lastTimestamp = raw.timestamp;
      this.sequence = 0;
    }
    return {
      id: `${raw.timestamp}#${this.sequence}`,
      ts: new Date(raw.timestamp.slice(0, 23) + 'Z').toISOString(),
      level: detectLogLevel(raw.text),
      text: raw.text,
    };
  }
}

interface ParsedId {
  timestamp: string;
  sequence: number;
}

const ID_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z)#(\d+)$/;

export const parseLineId = (id: string): ParsedId | null => {
  const match = ID_PATTERN.exec(id);
  return match ? { timestamp: match[1], sequence: Number(match[2]) } : null;
};

// true kalau baris `id` datang sesudah `afterId`.
export const isAfterId = (id: string, afterId: string | undefined) => {
  if (!afterId) return true;
  const a = parseLineId(id);
  const b = parseLineId(afterId);
  if (!a || !b) return true;
  if (a.timestamp !== b.timestamp) return a.timestamp > b.timestamp;
  return a.sequence > b.sequence;
};

// Detik UNIX untuk parameter `since` docker logs (dibulatkan ke bawah;
// baris yang sudah terkirim dibuang lewat isAfterId).
export const idToSinceSeconds = (id: string): number | null => {
  const parsed = parseLineId(id);
  if (!parsed) return null;
  return Math.floor(Date.parse(parsed.timestamp.slice(0, 19) + 'Z') / 1000);
};

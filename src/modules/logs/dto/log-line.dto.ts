export type LogLevel = 'ERROR' | 'WARN' | 'INFO';

// Kontrak dengan FE (dashboard-monitoring-fe/src/lib/types/log.types.ts).
export interface LogLineDto {
  // Bisa diurutkan: timestamp Docker nanodetik + nomor urut. Dipakai juga
  // sebagai SSE id (Last-Event-ID).
  id: string;
  // ISO milidetik, untuk tampilan.
  ts: string;
  level: LogLevel;
  text: string;
}

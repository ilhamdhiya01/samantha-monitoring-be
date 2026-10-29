import type { LogLevel } from './dto/log-line.dto';

// Aturan PRD: baris berisi ERROR, Traceback, exception, atau status HTTP
// 5xx = error; WARN atau 4xx = warning; selain itu info.
//
// Status HTTP hanya dicocokkan di posisinya (setelah request line yang
// dikutip, atau `status=`), supaya "took 500ms" atau "id=404" tidak ikut
// terhitung.
// TODO: aturan per container lewat config (PRD) — belum ada UI Pengaturan.

const ERROR_PATTERNS = [
  /\b(ERROR|ERR|FATAL|CRITICAL|CRIT|PANIC|EMERG)\b/,
  /Traceback \(most recent call last\)/,
  /exception/i,
  // KeyError:, psycopg2.OperationalError:, TypeError:
  /\b[A-Z][A-Za-z]*(Error|Exception):/,
  /\blevel["']?\s*[=:]\s*["']?(error|fatal|critical|panic)\b/i,
  /\[(error|crit|alert|emerg)\]/i,
];

const WARN_PATTERNS = [
  /\b(WARN|WARNING)\b/,
  /\blevel["']?\s*[=:]\s*["']?(warn|warning)\b/i,
  /\[warn\]/i,
];

// "GET /path HTTP/1.1" 500 …  |  status=500  |  "status":500
const HTTP_STATUS = [
  /"[A-Z]+ [^"]* HTTP\/[\d.]+"\s+(\d{3})\b/,
  /\bstatus(?:_code)?["']?\s*[=:]\s*["']?(\d{3})\b/i,
];

const httpStatus = (text: string): number | null => {
  for (const pattern of HTTP_STATUS) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
};

export const detectLogLevel = (text: string): LogLevel => {
  const status = httpStatus(text);
  if (status !== null && status >= 500 && status <= 599) return 'ERROR';
  if (ERROR_PATTERNS.some((pattern) => pattern.test(text))) return 'ERROR';
  if (status !== null && status >= 400 && status <= 499) return 'WARN';
  if (WARN_PATTERNS.some((pattern) => pattern.test(text))) return 'WARN';
  return 'INFO';
};

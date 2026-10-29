// Batas baris per detik untuk satu koneksi SSE (PRD: 50/dtk). Kelebihannya
// tidak dikirim, cukup dihitung lalu dilaporkan sebagai "N baris dilewati".
// Penghitung error tetap menerima semua baris — throttle hanya di jalur
// ke browser.
export class LineThrottle {
  private windowStart = 0;
  private sent = 0;
  private skipped = 0;

  constructor(private readonly maxPerSecond: number) {}

  accept(now: number): boolean {
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.sent = 0;
    }
    if (this.sent < this.maxPerSecond) {
      this.sent += 1;
      return true;
    }
    this.skipped += 1;
    return false;
  }

  // Jumlah baris yang dilewati sejak panggilan terakhir.
  drainSkipped(): number {
    const skipped = this.skipped;
    this.skipped = 0;
    return skipped;
  }
}

# VPS Docker Monitor — Backend

NestJS yang membaca Docker Engine API dan resource host, lalu menyajikan REST + SSE untuk [`dashboard-monitoring-fe`](../dashboard-monitoring-fe). Hitungan error per jam, riwayat deploy, dan alert disimpan di PostgreSQL; alert dikirim ke Telegram. Log mentah tetap di Docker.

## Menjalankan lokal

```bash
cp .env.example .env
pnpm install
docker compose up -d monitor-db          # Postgres di 127.0.0.1:5443
pnpm exec prisma migrate dev
pnpm start:dev                           # http://localhost:3001/api/v1
```

FE: di `dashboard-monitoring-fe`, jalankan `VITE_USE_MOCK=false pnpm dev` — `/api` di-proxy ke `127.0.0.1:3001`.

Di Mac, Docker Desktop menyediakan `/var/run/docker.sock`; resource host jatuh ke modul `os` karena `/proc` tidak ada.

## Endpoint (`/api/v1`)

| Endpoint                     | Isi                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /system`                | CPU, RAM, disk (+ ukuran Docker), uptime, info host                                                  |
| `GET /containers`            | status, image:tag, CPU/RAM, restart, waktu start                                                     |
| `GET /images`                | image per tag: active / previous / dangling, waktu deploy                                            |
| `GET /alerts/active`         | alert yang belum selesai                                                                             |
| `GET /metrics/errors-hourly` | error & warning per jam, 24 jam                                                                      |
| `GET /stream`                | SSE: `stats` dan `containers` tiap 5 dtk, `alerts` saat alert muncul/pulih — menggantikan polling FE |
| `GET /logs/:name/stream`     | SSE: 500 baris terakhir lalu live; `Last-Event-ID` / `?lastEventId=` untuk melanjutkan               |
| `GET /health`                | `{ status, db, docker }` untuk uptime monitor eksternal                                              |

Respons: `{ data, message }`; error: `{ errors: [{ field, message }] }`.

```bash
curl -N localhost:3001/api/v1/logs/<nama-container>/stream
```

## Deploy di VPS

```bash
cp .env.example .env    # isi POSTGRES_PASSWORD, FE_URL, TELEGRAM_*, HOST_IP
docker compose -f docker-compose.yml up -d --build monitor-api
```

Service: `docker-proxy` (Docker API read-only, POST ditolak), `monitor-db`, `monitor-migrate` (sekali jalan), `monitor-api` (mount `/proc` dan `/` host read-only). Semua `restart: unless-stopped`, log driver `max-size 50m × 3`.

> **Belum ada login.** Jangan publish port 3001 ke internet; akses lewat SSH tunnel atau jaringan privat sampai auth selesai.

Pasang uptime monitor eksternal (healthchecks.io / UptimeRobot) ke `GET /api/v1/health` — kalau VPS mati, monitor ini tidak bisa mengirim alert sendiri.

## Konfigurasi

Lihat `.env.example`. Ambang alert: `ALERT_DISK_PCT` (80), `ALERT_RESTART_COUNT` (3) dalam `ALERT_RESTART_WINDOW_MIN` (10), `ALERT_ERROR_COUNT` (10/jam), cooldown `ALERT_COOLDOWN_MIN` (30). Telegram kosong = alert hanya disimpan & di-log.

## Skrip

`pnpm lint` · `pnpm test` · `pnpm test:e2e` · `pnpm build` · `pnpm start:prod`

Keputusan teknis dan penyimpangan dari PRD: `CLAUDE.md`.

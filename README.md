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

Di Mac, Docker Desktop versi baru tidak selalu membuat `/var/run/docker.sock` — kalau tidak ada, isi `DOCKER_SOCKET=$HOME/.docker/run/docker.sock` (path absolut) di `.env`. Resource host jatuh ke modul `os` karena `/proc` tidak ada.

## Endpoint (`/api/v1`)

| Endpoint                                | Isi                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /system`                           | CPU, RAM, disk (+ ukuran Docker), uptime, info host                                                      |
| `GET /containers`                       | status, image:tag, CPU/RAM, restart, waktu start, compose project/service, health, OOM, restart policy   |
| `GET /images`                           | image per tag: active / previous / dangling, waktu deploy                                                |
| `GET /alerts/active`                    | alert yang belum selesai                                                                                 |
| `GET /alerts/history`                   | 50 alert terbaru termasuk yang sudah pulih; `?container=` untuk satu container                           |
| `GET /metrics/errors-hourly`            | error & warning per jam, 24 jam; `?container=` untuk satu container (default semua)                      |
| `GET /deploys`                          | 20 event `container create` terbaru; `?container=` untuk satu container                                  |
| `GET /stream`                           | SSE: `stats` dan `containers` tiap 5 dtk, `alerts` saat alert muncul/pulih — menggantikan polling FE     |
| `GET /logs/:name/stream`                | SSE: 500 baris terakhir lalu live; `Last-Event-ID` / `?lastEventId=` untuk melanjutkan                   |
| `GET /actions/status`                   | apakah stop/start aktif, dan alasannya kalau tidak                                                       |
| `POST /containers/:name/stop`, `/start` | body JSON `{ "confirm": "<nama>" }`; mati kecuali `ACTIONS_ENABLED=true`; dicatat ke `container_actions` |
| `GET /health`                           | `{ status, db, docker }` untuk uptime monitor eksternal                                                  |

Respons: `{ data, message }`; error: `{ errors: [{ field, message }] }`.

```bash
curl -N localhost:3001/api/v1/logs/<nama-container>/stream
```

## Deploy di VPS

Pola sama dengan project lain di VPS: GitHub Actions (`.github/workflows/docker-publish.yml`) menjalankan CI, mem-build image ke `ghcr.io/ilhamdhiya01/samantha-monitoring-be:latest` (+ `latest-migrator`), lalu SSH ke VPS dan menjalankan `docker compose pull && up -d`. Secrets repo: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

Setup sekali di VPS (`~/dashboard-monitoring/samantha-monitoring-be`): salin `docker-compose.yml` dan buat `.env`:

```
POSTGRES_PASSWORD=<acak>
FE_URL=http://localhost:3310
HOST_IP=<ip vps>
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Service: `docker-proxy` (Docker API read-only, POST ditolak), `docker-action-proxy` (hanya `POST /containers/{id}/stop` dan `/start`), `monitor-db`, `monitor-migrate` (sekali jalan), `monitor-api` di `127.0.0.1:3300` (mount `/proc` dan `/` host read-only). Network `monitor` dipakai juga oleh FE. `docker-compose.override.yml` khusus dev — jangan disalin ke VPS.

> **Belum ada login.** Stop/start dari dashboard mati sampai `ACTIONS_ENABLED=true` di `.env`; container milik monitor sendiri tidak bisa di-stop. Port hanya di loopback; buka lewat SSH tunnel: `ssh -L 3310:127.0.0.1:3310 ubuntu@<vps>` lalu `http://localhost:3310` (FE meneruskan `/api/v1` ke BE).

Pasang uptime monitor eksternal ke `GET /api/v1/health` setelah ada domain — kalau VPS mati, monitor ini tidak bisa mengirim alert sendiri.

## Konfigurasi

Lihat `.env.example`. Ambang alert: `ALERT_DISK_PCT` (80), `ALERT_RESTART_COUNT` (3) dalam `ALERT_RESTART_WINDOW_MIN` (10), `ALERT_ERROR_COUNT` (10/jam), cooldown `ALERT_COOLDOWN_MIN` (30). Telegram kosong = alert hanya disimpan & di-log.

## Skrip

`pnpm lint` · `pnpm test` · `pnpm test:e2e` · `pnpm build` · `pnpm start:prod`

Keputusan teknis dan penyimpangan dari PRD: `CLAUDE.md`.

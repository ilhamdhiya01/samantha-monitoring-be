# CLAUDE.md

Backend **VPS Docker Monitor** — NestJS yang membaca Docker Engine API + `/proc` host, menyajikan REST + SSE untuk `dashboard-monitoring-fe`, menyimpan hitungan/riwayat di PostgreSQL, dan mengirim alert Telegram. Sumber kebenaran produk: PRD "VPS Docker Monitor" (29 Okt 2026, dipegang user). Struktur dan tooling mengikuti `critiq-be`.

Kalau PRD direvisi, perbarui file ini dan README dulu, lalu kode — dan sebutkan eksplisit bagian mana yang jadi usang.

## Perintah

```bash
pnpm start:dev        # :3001, butuh monitor-db (docker compose up -d monitor-db)
pnpm lint             # WAJIB lolos
pnpm test             # unit (Jest, *.spec.ts di src/)
pnpm test:e2e         # test/*.e2e-spec.ts
pnpm exec prisma migrate dev --name <nama>
pnpm exec prisma generate
```

## Stack & keputusan

| Area     | Pilihan                                              | Catatan                                                                                                                                                                                        |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP     | NestJS 11 + **Express**                              | PRD menyebut Fastify; Express dipilih supaya pola critiq-be (filter, interceptor, SSE) dipakai apa adanya. Selisih RAM beberapa MB.                                                            |
| Prefix   | `/api/v1`                                            | sama dengan critiq-be                                                                                                                                                                          |
| Docker   | `dockerode`                                          | Lewat `DOCKER_HOST` (docker-socket-proxy) di produksi, socket langsung di dev                                                                                                                  |
| DB       | PostgreSQL 16 + Prisma 7.10.0 (`@prisma/adapter-pg`) | Postgres monitor terpisah dari Postgres tees-api                                                                                                                                               |
| Realtime | SSE (`@Sse`), fan-out RxJS `Subject` di memori       | Tanpa Redis — backend satu proses                                                                                                                                                              |
| Jadwal   | `@nestjs/schedule` (`@Interval`, `@Cron`)            |                                                                                                                                                                                                |
| Alert    | Telegram Bot API lewat `fetch`                       | Tanpa library                                                                                                                                                                                  |
| Auth     | **Belum ada**                                        | Scope tahap ini: Fase 1 + alert. Login (argon2 + session cookie 7 hari) menyusul bersama halaman login FE. Sampai itu, **jangan expose ke publik** — hanya lewat SSH tunnel / jaringan privat. |

## Struktur

```
src/
  common/      CommonModule (config Joi, Winston, Prisma, filter, interceptor) — disalin dari critiq-be
  config/      configuration.ts + validation.schema.ts
  modules/
    docker/      DockerService (global), log-stream.ts (demux + pemotong baris)
    events/      stream /events → Subject; event `create` → tabel deploy_events
    system/      resource host, poll 5 dtk
    containers/  list + inspect + stats, poll 5 dtk
    images/      tabel image + status active/previous/dangling
    logs/        ingestor (follow semua container), riwayat, SSE
    metrics/     hitungan error/warning per jam
    alerts/      evaluator + Telegram + GET /alerts/active
    retention/   cron harian
    health/      GET /health untuk uptime monitor eksternal
```

Pola modul sama dengan critiq-be: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `*.spec.ts` di sebelah file yang dites. Controller mengembalikan nilai biasa + `@ResponseMessage()`; envelope `{ data, message }` / `{ errors: [...] }` dipasang global.

## Kontrak API

Tipe harus sama dengan `dashboard-monitoring-fe/src/lib/types/*` (DTO di `modules/*/dto/` menyebut file FE-nya). Ubah keduanya bersamaan.

| Endpoint                     | DTO                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /system`                | `SystemStatsDto`                                                                                           |
| `GET /containers`            | `ContainerDto[]`                                                                                           |
| `GET /images`                | `ImageSummaryDto`                                                                                          |
| `GET /alerts/active`         | `AlertDto[]` (enum lowercase)                                                                              |
| `GET /metrics/errors-hourly` | `ErrorHourDto[]` (24 bucket)                                                                               |
| `GET /stream`                | SSE: `ready`, `stats` (`SystemStatsDto`), `containers` (`ContainerDto[]`), `alerts` (`AlertDto[]`), `ping` |
| `GET /logs/:name/stream`     | SSE: `log` (`LogLineDto`), `skipped` (`{ count }`), `ping`                                                 |
| `GET /health`                | `{ status, db, docker }`, 503 kalau DB/Docker mati                                                         |

## Data & alur

- **Poll sekali untuk semua request** (PRD): `SystemService` dan `ContainersService` poll tiap 5 dtk ke cache; controller hanya membaca cache. Poll tidak menumpuk (`polling ??=`).
- **Resource host**: `/proc/{stat,meminfo,loadavg,uptime}` dari `HOST_PROC`, disk `statfs(HOST_ROOT)`. Hostname/OS/versi/core dari `docker info` — dari dalam container `os.hostname()` cuma id container. Di Mac (dev) `/proc` tidak ada → fallback modul `os` (angka memori Mac tidak akurat; tidak masalah untuk dev).
- **Ingestor log** (`LogIngestorService`) mengikuti log **semua** container yang running sepanjang waktu — grafik error dan alert butuh setiap baris, bukan hanya container yang dibuka di browser. Attach ulang saat event `start`. Satu stream Docker per container; semua tab berbagi lewat `Subject` per nama container.
- **Level log** (`log-parser.ts`): aturan PRD. Status HTTP hanya dicocokkan di posisinya (setelah request line yang dikutip, atau `status=`) — "took 500ms" bukan error. Aturan per container lewat config: **belum** (TODO, butuh halaman Pengaturan).
- **Hitungan error** dikumpulkan di memori, di-upsert ke `error_hourly` tiap menit (bukan per baris) dan saat shutdown. `GET /metrics/errors-hourly` menjumlahkan DB + yang belum di-flush.
- **SSE log**: subscribe live dulu, ambil `docker logs tail=500`, kirim riwayat, lalu baris live yang lebih baru — tanpa celah, tanpa dobel. Throttle 50 baris/dtk per koneksi (sisanya event `skipped`); penghitung error tetap menerima semua baris.
- **Id baris** = timestamp Docker 9 digit + `#urutan` (`2026-10-29T10:42:01.221234567Z#0`) — bisa dibandingkan, stateless.
- **SSE `/stream`** (`modules/stream/`) menggantikan polling FE untuk system, containers dan alert aktif. `SystemService`/`ContainersService` mengumumkan setiap hasil poll lewat `updates$`; `AlertsService.markChanged()` dipanggil evaluator saat alert muncul/pulih. Saat tersambung (juga reconnect) kondisi terkini dikirim duluan → FE tidak perlu refetch. Payload selalu data lengkap, bukan selisih, jadi event yang hilang tidak membuat state FE salah. REST `/system`, `/containers`, `/alerts/active` tetap ada (load awal, fallback saat stream putus).
- **Riwayat deploy** = event `container create` yang ditangkap saat monitor jalan. Docker tidak menyimpan event lama → riwayat mulai sejak monitor dipasang.

### Penyimpangan dari PRD (sengaja)

- **Resume SSE tanpa ring buffer.** PRD: ring buffer 500 baris di memori untuk `Last-Event-ID`, fallback `docker logs --since`. Di sini resume selalu lewat `docker logs --since` + buang id ≤ terakhir: satu jalur kode untuk tail maupun resume, tanpa memori per container.
- **Express**, bukan Fastify (lihat tabel).
- **Event `alerts`** (jamak, berisi daftar aktif lengkap), bukan `alert` seperti di PRD: daftar lengkap idempoten dan langsung menggantikan cache FE; satu event per alert memaksa FE menggabungkan sendiri dan salah kalau ada event yang hilang.
- **Endpoint SSE 404**: container tak dikenal ditolak di `ContainerExistsGuard`, bukan di handler — di Nest 11 hanya guard yang jalan sebelum header `text/event-stream` ditulis; dari handler/pipe hasilnya 200 + `event: error` yang membuat EventSource reconnect terus.

## Alert

| Jenis              | Kapan                                                                                                                                    | Selesai otomatis                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `CONTAINER_EXITED` | `die` exit ≠ 0, **bukan** didahului `stop`/`kill` ≤ 10 dtk, dan masih mati 15 dtk kemudian                                               | container running lagi                   |
| `RESTART_LOOP`     | > `ALERT_RESTART_COUNT` event `start` dalam `ALERT_RESTART_WINDOW_MIN` menit (dari event, bukan `RestartCount` yang reset saat recreate) | running dan start dalam jendela ≤ ambang |
| `DISK_USAGE`       | disk > `ALERT_DISK_PCT`                                                                                                                  | disk ≤ ambang                            |
| `ERROR_SPIKE`      | > `ALERT_ERROR_COUNT` error dalam 60 menit bergulir                                                                                      | ≤ ambang                                 |

- Satu alert aktif per (jenis, container); setelah selesai, cooldown `ALERT_COOLDOWN_MIN` sebelum jenis yang sama dikirim lagi.
- Telegram kosong → alert tetap disimpan & di-log (`alert.fired`), satu warning `telegram.disabled` saat startup. Pesan pulih (`✅ Pulih: …`) hanya untuk alert yang sempat terkirim.
- Evaluator jalan tiap 60 dtk + langsung saat event Docker.

## Keamanan

- **Socket Docker = root di VPS.** Mount `:ro` **tidak** membuat API read-only (hanya melarang mengganti file socket; `POST /containers/create` tetap jalan). Produksi wajib lewat `docker-proxy` (tecnativa/docker-socket-proxy, `POST=0`); `monitor-api` tidak pernah me-mount socket.
- Belum ada login → jangan publish port 3001 / jangan pasang di subdomain publik sebelum auth ada.
- Baris log dikirim sebagai JSON teks; FE merender sebagai teks.
- Token Telegram hanya dari env, tidak pernah di-log.
- `monitor-db` tidak di-publish di produksi (override dev: `127.0.0.1:5443`).

## Tes

- Unit spec murni untuk helper (parser, demux, id, throttle, host-stats, container-stats, image-state, hour series) dan `alert-evaluator.service.spec.ts` dengan dependensi tiruan.
- `@nestjs/config` dan `@nestjs/schedule` v12 adalah **ESM murni**; Jest (CJS) tidak bisa memuatnya. `moduleNameMapper` mengarahkan keduanya ke `test/stubs/` — spec membuat `ConfigService` tiruan sendiri (`{ get }`) dan memanggil method terjadwal langsung. (critiq-be memakai `jest.mock` per file untuk masalah yang sama.)
- Generated Prisma client memakai import `.js` → dipetakan oleh `moduleNameMapper`.

## Belum ada (sesuai scope)

Login/auth, aksi tulis v1.1 (rollback, prune, restart — butuh proxy dengan POST terbatas + konfirmasi + audit log), riwayat alert (endpoint), aturan level per container, webhook deploy dari CI (commit hash), service `monitor-web` (Nginx untuk FE) di compose, `pg_dump` mingguan.

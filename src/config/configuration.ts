export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3001),
  database: {
    url: process.env.DATABASE_URL,
  },
  // Origin FE untuk CORS saat dev (FE :3000, BE :3001). Di produksi FE dan
  // BE satu origin di belakang Nginx, jadi CORS tidak terpakai.
  feUrl: process.env.FE_URL,
  docker: {
    // DOCKER_HOST (mis. tcp://docker-proxy:2375) menang atas socket.
    // Produksi wajib lewat docker-socket-proxy: mount socket `:ro` tidak
    // membuat Docker API read-only (lihat CLAUDE.md "Keamanan").
    host: process.env.DOCKER_HOST ?? '',
    socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  },
  host: {
    // /proc dan / milik host, di-mount read-only ke container monitor.
    // Di luar Linux (dev di Mac) /proc tidak ada → fallback ke modul `os`.
    procPath: process.env.HOST_PROC ?? '/proc',
    rootPath: process.env.HOST_ROOT ?? '/',
    ip: process.env.HOST_IP ?? '',
  },
  telegram: {
    // Kosong = alert tetap disimpan & di-log, tapi tidak dikirim.
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },
  alert: {
    diskPercent: Number(process.env.ALERT_DISK_PCT ?? 80),
    restartCount: Number(process.env.ALERT_RESTART_COUNT ?? 3),
    restartWindowMin: Number(process.env.ALERT_RESTART_WINDOW_MIN ?? 10),
    errorCount: Number(process.env.ALERT_ERROR_COUNT ?? 10),
    cooldownMin: Number(process.env.ALERT_COOLDOWN_MIN ?? 30),
  },
  logs: {
    tail: Number(process.env.LOG_TAIL ?? 500),
    sseMaxLinesPerSec: Number(process.env.LOG_SSE_MAX_LINES_PER_SEC ?? 50),
  },
});

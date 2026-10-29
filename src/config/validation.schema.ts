import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  PORT: Joi.number().port().default(3001),
  DATABASE_URL: Joi.string().required(),
  FE_URL: Joi.string().uri().required(),
  DOCKER_HOST: Joi.string()
    .uri({ scheme: ['tcp', 'http', 'https'] })
    .allow('')
    .optional(),
  DOCKER_SOCKET: Joi.string().default('/var/run/docker.sock'),
  HOST_PROC: Joi.string().default('/proc'),
  HOST_ROOT: Joi.string().default('/'),
  HOST_IP: Joi.string().allow('').optional(),
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').optional(),
  TELEGRAM_CHAT_ID: Joi.string().allow('').optional(),
  ALERT_DISK_PCT: Joi.number().min(1).max(100).default(80),
  ALERT_RESTART_COUNT: Joi.number().integer().min(1).default(3),
  ALERT_RESTART_WINDOW_MIN: Joi.number().integer().min(1).default(10),
  ALERT_ERROR_COUNT: Joi.number().integer().min(1).default(10),
  ALERT_COOLDOWN_MIN: Joi.number().integer().min(0).default(30),
  LOG_TAIL: Joi.number().integer().min(0).max(5000).default(500),
  LOG_SSE_MAX_LINES_PER_SEC: Joi.number().integer().min(1).default(50),
});

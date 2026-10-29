# syntax=docker/dockerfile:1
# Pola sama dengan critiq-be: builder → migrator (job sekali jalan) → runner.

# ---- Stage 1: build ----
FROM node:24.14.0-alpine AS builder
ENV HUSKY=0
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
# Hanya membaca schema.prisma, tanpa koneksi DB.
RUN pnpm exec prisma generate
RUN pnpm run build

# Runtime hanya butuh `dependencies` — package.json tulisan tangan supaya
# CLI `prisma` (peer dependency @prisma/client, ~250 MB) tidak ikut.
RUN node -e "\
  const fs = require('fs'); \
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  fs.writeFileSync('runtime.package.json', JSON.stringify({ name: pkg.name, private: true, dependencies: pkg.dependencies }, null, 2)); \
  "

# ---- Stage 2: migrator (prisma migrate deploy, lalu selesai) ----
FROM node:24.14.0-alpine AS migrator
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---- Stage 3: runtime ----
FROM node:24.14.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --gid 1001 nodejs && \
    adduser --uid 1001 --ingroup nodejs --shell /bin/false --disabled-password nestjs

COPY --from=builder --chown=nestjs:nodejs /app/runtime.package.json ./package.json
RUN npm install --package-lock-only --no-audit --no-fund && \
    npm ci --no-audit --no-fund --ignore-scripts && \
    npm cache clean --force
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

USER nestjs
EXPOSE 3001
# Pakai node langsung (bukan pnpm) supaya SIGTERM sampai ke proses Nest.
CMD ["node", "dist/src/main.js"]

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('CONTAINER_EXITED', 'RESTART_LOOP', 'DISK_USAGE', 'ERROR_SPIKE');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('CRITICAL', 'WARNING');

-- CreateTable
CREATE TABLE "error_hourly" (
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "container" VARCHAR(128) NOT NULL,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "warnings" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "error_hourly_pkey" PRIMARY KEY ("hour","container")
);

-- CreateTable
CREATE TABLE "deploy_events" (
    "id" TEXT NOT NULL,
    "container" VARCHAR(128) NOT NULL,
    "imageId" VARCHAR(80) NOT NULL,
    "image" VARCHAR(255) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deploy_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "container" VARCHAR(128),
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "firedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deploy_events_imageId_occurredAt_idx" ON "deploy_events"("imageId", "occurredAt");

-- CreateIndex
CREATE INDEX "deploy_events_occurredAt_idx" ON "deploy_events"("occurredAt");

-- CreateIndex
CREATE INDEX "alerts_kind_container_firedAt_idx" ON "alerts"("kind", "container", "firedAt");

-- CreateIndex
CREATE INDEX "alerts_resolvedAt_idx" ON "alerts"("resolvedAt");

-- CreateEnum
CREATE TYPE "ContainerActionKind" AS ENUM ('STOP', 'START');

-- CreateTable
CREATE TABLE "container_actions" (
    "id" TEXT NOT NULL,
    "action" "ContainerActionKind" NOT NULL,
    "container" VARCHAR(128) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "container_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "container_actions_createdAt_idx" ON "container_actions"("createdAt");

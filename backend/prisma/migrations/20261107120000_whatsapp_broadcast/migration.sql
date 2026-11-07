-- CreateTable
CREATE TABLE "WhatsappBroadcast" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "intervalSec" INTEGER NOT NULL DEFAULT 180,
    "createdById" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappBroadcastItem" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "studentId" TEXT,
    "recipientName" TEXT,
    "phone" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "externalMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappBroadcastItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappBroadcast_status_createdAt_idx" ON "WhatsappBroadcast"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappBroadcastItem_broadcastId_status_position_idx" ON "WhatsappBroadcastItem"("broadcastId", "status", "position");

-- CreateIndex
CREATE INDEX "WhatsappBroadcastItem_status_claimedAt_idx" ON "WhatsappBroadcastItem"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "WhatsappBroadcastItem_reminderId_idx" ON "WhatsappBroadcastItem"("reminderId");

-- AddForeignKey
ALTER TABLE "WhatsappBroadcastItem" ADD CONSTRAINT "WhatsappBroadcastItem_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "WhatsappBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Payment" ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "cancellationReason" TEXT,
    ADD COLUMN "isCancellation" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FinancialRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

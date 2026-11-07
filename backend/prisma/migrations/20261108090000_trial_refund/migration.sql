-- Document 26: refund of the diagnostic-lesson fee. Additive only: nothing is dropped or rewritten.
ALTER TABLE "CashTransaction" ADD COLUMN IF NOT EXISTS "refundOfCashTransactionId" TEXT;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "trialRefundedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "trialRefundedById" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "trialRefundReason" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "trialRefundOutsidePolicy" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "CashTransaction_refundOfCashTransactionId_key" ON "CashTransaction"("refundOfCashTransactionId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CashTransaction_refundOfCashTransactionId_fkey'
    ) THEN
        ALTER TABLE "CashTransaction"
            ADD CONSTRAINT "CashTransaction_refundOfCashTransactionId_fkey"
            FOREIGN KEY ("refundOfCashTransactionId") REFERENCES "CashTransaction"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

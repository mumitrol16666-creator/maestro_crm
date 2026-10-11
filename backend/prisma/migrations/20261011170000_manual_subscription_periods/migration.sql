-- CreateTable
CREATE TABLE "SubscriptionRenewal" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "previousMembershipId" TEXT NOT NULL,
    "membershipId" TEXT,
    "paymentId" TEXT,
    "terms" JSONB NOT NULL,
    "documentBasis" JSONB NOT NULL,
    "creditAmount" INTEGER NOT NULL,
    "creditReason" TEXT NOT NULL,
    "paymentPayload" JSONB NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentIntent" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "InstallmentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRenewal_membershipId_key" ON "SubscriptionRenewal"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRenewal_paymentId_key" ON "SubscriptionRenewal"("paymentId");

-- CreateIndex
CREATE INDEX "SubscriptionRenewal_studentId_createdAt_idx" ON "SubscriptionRenewal"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentIntent_paymentId_key" ON "InstallmentIntent"("paymentId");

-- CreateIndex
CREATE INDEX "InstallmentIntent_membershipId_createdAt_idx" ON "InstallmentIntent"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionRenewal" ADD CONSTRAINT "SubscriptionRenewal_previousMembershipId_fkey" FOREIGN KEY ("previousMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionRenewal" ADD CONSTRAINT "SubscriptionRenewal_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionRenewal" ADD CONSTRAINT "SubscriptionRenewal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentIntent" ADD CONSTRAINT "InstallmentIntent_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentIntent" ADD CONSTRAINT "InstallmentIntent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "SubscriptionRenewal_open_student" ON "SubscriptionRenewal" ("studentId") WHERE "confirmedAt" IS NULL AND "cancelledAt" IS NULL;
CREATE UNIQUE INDEX "SubscriptionRenewal_used_source" ON "SubscriptionRenewal" ("previousMembershipId") WHERE "cancelledAt" IS NULL;
CREATE UNIQUE INDEX "InstallmentIntent_pending" ON "InstallmentIntent" ("membershipId") WHERE "paymentId" IS NULL AND "cancelledAt" IS NULL;
ALTER TABLE "SubscriptionRenewal" ADD CONSTRAINT "SubscriptionRenewal_credit_nonnegative" CHECK ("creditAmount" >= 0);
CREATE FUNCTION protect_subscription_renewal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'renewal calculation is immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['membershipId','paymentId','confirmedById','confirmedAt','cancelledAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['membershipId','paymentId','confirmedById','confirmedAt','cancelledAt']) OR OLD."confirmedAt" IS NOT NULL OR OLD."cancelledAt" IS NOT NULL
  THEN RAISE EXCEPTION 'renewal calculation is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "SubscriptionRenewal_immutable" BEFORE UPDATE OR DELETE ON "SubscriptionRenewal" FOR EACH ROW EXECUTE FUNCTION protect_subscription_renewal();

ALTER TABLE "Membership"
  ADD COLUMN "programMonths" INTEGER,
  ADD COLUMN "additionalDiscountType" TEXT,
  ADD COLUMN "additionalDiscountBasisPoints" INTEGER,
  ADD COLUMN "additionalDiscountAmount" INTEGER,
  ADD COLUMN "additionalDiscountReason" TEXT,
  ADD COLUMN "individualBudgetTotal" INTEGER,
  ADD COLUMN "individualBudgetRemaining" INTEGER;

ALTER TABLE "MembershipTransaction" ADD COLUMN "chargeAmount" INTEGER;

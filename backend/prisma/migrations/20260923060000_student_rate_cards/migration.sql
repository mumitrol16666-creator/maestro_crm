ALTER TABLE "Group" ADD COLUMN "billingType" TEXT;
ALTER TABLE "MembershipPlan" ADD COLUMN "lessonRates" JSONB;
ALTER TABLE "Membership" ADD COLUMN "billingModel" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "Membership" ADD COLUMN "tariffName" TEXT;
ALTER TABLE "Membership" ADD COLUMN "lessonRates" JSONB;
ALTER TABLE "Group" ADD CONSTRAINT "Group_billingType_check"
  CHECK ("billingType" IS NULL OR "billingType" IN ('quartet', 'duo', 'trio', 'theory'));
CREATE INDEX "Membership_studentId_billingModel_status_idx" ON "Membership" ("studentId", "billingModel", "status");

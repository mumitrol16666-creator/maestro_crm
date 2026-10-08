-- Imported rate cards keep their existing access until an administrator sets dates.
ALTER TABLE "Membership" ADD COLUMN "validFrom" DATE, ADD COLUMN "validUntil" DATE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_validity_range_check"
  CHECK (("validFrom" IS NULL AND "validUntil" IS NULL)
    OR ("validFrom" IS NOT NULL AND "validUntil" IS NOT NULL AND "validUntil" >= "validFrom"));
ALTER TABLE "Student" ADD COLUMN "individualScheduleGeneratedThrough" TIMESTAMP(3);

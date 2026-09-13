-- Add the new purchase model without modifying historical paid prices or balances.
ALTER TABLE "Direction"
    ADD COLUMN IF NOT EXISTS "trialLessonPrice" INTEGER NOT NULL DEFAULT 2000,
    ADD COLUMN IF NOT EXISTS "individualLessonPrice" INTEGER NOT NULL DEFAULT 4000,
    ADD COLUMN IF NOT EXISTS "theoryLessonPrice" INTEGER NOT NULL DEFAULT 1000,
    ADD COLUMN IF NOT EXISTS "groupLessonPrice" INTEGER NOT NULL DEFAULT 2250;

ALTER TABLE "Membership"
    ADD COLUMN IF NOT EXISTS "directionId" TEXT,
    ADD COLUMN IF NOT EXISTS "lessonPrice" INTEGER NOT NULL DEFAULT 0;

-- Some releases added nullable snapshots before adopting migrations.
ALTER TABLE "Membership"
    ADD COLUMN IF NOT EXISTS "individualLessonPrice" INTEGER,
    ADD COLUMN IF NOT EXISTS "theoryLessonPrice" INTEGER,
    ADD COLUMN IF NOT EXISTS "groupLessonPrice" INTEGER;

UPDATE "Membership" m
SET "directionId" = COALESCE(p."directionId", dp."directionId")
FROM "MembershipPlan" p
LEFT JOIN "DirectionPlan" dp ON dp.id = p."directionPlanId"
WHERE m."planId" = p.id AND m."directionId" IS NULL;

UPDATE "Membership" m SET "directionId" = d.id
FROM "Group" g JOIN "Direction" d ON d.name = g.direction
WHERE m."groupId" = g.id AND m."directionId" IS NULL;

CREATE INDEX IF NOT EXISTS "Membership_directionId_lessonFormat_status_idx"
    ON "Membership"("directionId", "lessonFormat", "status");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Membership_directionId_fkey') THEN
        ALTER TABLE "Membership" ADD CONSTRAINT "Membership_directionId_fkey"
        FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Hide old sale options; keep all records and their purchase references intact.
UPDATE "DirectionPlan" SET "isActive" = false WHERE "isActive" = true;
UPDATE "MembershipPlan" SET "isVisible" = false WHERE "isVisible" = true;

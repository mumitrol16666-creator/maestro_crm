-- Plan 1.11: a free exam lesson booked for a sector exam prepared on the learning platform.
ALTER TYPE "ClassType" ADD VALUE IF NOT EXISTS 'exam';

ALTER TABLE "Class" ADD COLUMN "sectorExamId" TEXT;
CREATE UNIQUE INDEX "Class_sectorExamId_key" ON "Class"("sectorExamId");

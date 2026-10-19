-- Plan 1.11: an exam lesson may hold several students' sector exams.
CREATE TABLE "ClassSectorExam" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectorExamId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassSectorExam_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClassSectorExam_sectorExamId_key" ON "ClassSectorExam"("sectorExamId");
CREATE INDEX "ClassSectorExam_classId_idx" ON "ClassSectorExam"("classId");
CREATE INDEX "ClassSectorExam_studentId_idx" ON "ClassSectorExam"("studentId");
ALTER TABLE "ClassSectorExam" ADD CONSTRAINT "ClassSectorExam_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassSectorExam" ADD CONSTRAINT "ClassSectorExam_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exam lessons booked one per student keep their link, now as a row of the new table.
INSERT INTO "ClassSectorExam" ("id", "classId", "sectorExamId", "studentId", "createdAt")
SELECT 'cse_' || "id", "id", "sectorExamId", "individualStudentId", "createdAt"
FROM "Class"
WHERE "sectorExamId" IS NOT NULL AND "individualStudentId" IS NOT NULL;

DROP INDEX "Class_sectorExamId_key";
ALTER TABLE "Class" DROP COLUMN "sectorExamId";

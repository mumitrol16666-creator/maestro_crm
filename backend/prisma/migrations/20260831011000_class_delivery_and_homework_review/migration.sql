-- CreateEnum
CREATE TYPE "ClassDeliveryFormat" AS ENUM ('offline', 'online');

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "deliveryFormat" "ClassDeliveryFormat" NOT NULL DEFAULT 'offline',
ADD COLUMN     "meetingUrl" VARCHAR(1024);

-- AlterTable
ALTER TABLE "ClassAttendee" ADD COLUMN     "reviewedHomeworkClassId" TEXT;

-- CreateIndex
CREATE INDEX "ClassAttendee_reviewedHomeworkClassId_idx" ON "ClassAttendee"("reviewedHomeworkClassId");

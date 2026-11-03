-- Document 23, step 2: the mark «лист первого занятия отдан» on a trial booking.
ALTER TABLE "Booking" ADD COLUMN "trialSheetGivenAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "trialSheetGivenById" TEXT;

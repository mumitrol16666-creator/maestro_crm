CREATE TABLE "Enrollment" (
 "id" TEXT PRIMARY KEY, "studentId" TEXT NOT NULL UNIQUE REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "responsibleId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0, "customer" JSONB, "terms" JSONB,
 "membershipId" TEXT UNIQUE REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "activatedAt" TIMESTAMP(3), "studentHandedAt" TIMESTAMP(3), "parentHandedAt" TIMESTAMP(3), "parentUserId" TEXT,
 "lastAccessError" TEXT, "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Enrollment_completedAt_updatedAt_idx" ON "Enrollment"("completedAt", "updatedAt");
CREATE TABLE "EnrollmentDocument" (
 "id" TEXT PRIMARY KEY, "enrollmentId" TEXT NOT NULL REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "number" SERIAL UNIQUE, "revision" INTEGER NOT NULL, "templateVersion" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "html" TEXT NOT NULL,
 "preparedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "printedAt" TIMESTAMP(3),
 "contractSignedAt" TIMESTAMP(3), "appendixSignedAt" TIMESTAMP(3), "consentSignedAt" TIMESTAMP(3), "signedById" TEXT,
 UNIQUE("enrollmentId", "revision")
);
CREATE TABLE "EnrollmentPaymentIntent" (
 "id" TEXT PRIMARY KEY, "enrollmentId" TEXT NOT NULL REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "payload" JSONB NOT NULL, "createdById" TEXT NOT NULL, "paymentId" TEXT UNIQUE REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "confirmedAt" TIMESTAMP(3)
);
CREATE INDEX "EnrollmentPaymentIntent_enrollmentId_createdAt_idx" ON "EnrollmentPaymentIntent"("enrollmentId", "createdAt");
CREATE UNIQUE INDEX "EnrollmentPaymentIntent_one_pending" ON "EnrollmentPaymentIntent"("enrollmentId") WHERE "paymentId" IS NULL AND "cancelledAt" IS NULL;
CREATE FUNCTION protect_enrollment_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR NEW."html" IS DISTINCT FROM OLD."html"
 OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion"
 OR NEW."enrollmentId" IS DISTINCT FROM OLD."enrollmentId" OR NEW."revision" IS DISTINCT FROM OLD."revision" THEN
  RAISE EXCEPTION 'Issued enrollment documents are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enrollment_document_immutable BEFORE UPDATE OR DELETE ON "EnrollmentDocument" FOR EACH ROW EXECUTE FUNCTION protect_enrollment_document();

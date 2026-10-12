CREATE TABLE "DocumentScan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "enrollmentDocumentId" TEXT REFERENCES "EnrollmentDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "renewalDocumentId" TEXT REFERENCES "RenewalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "digest" TEXT NOT NULL,
  "fileData" BYTEA NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  "withdrawnAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewReason" TEXT,
  CONSTRAINT "DocumentScan_target" CHECK (("enrollmentDocumentId" IS NOT NULL)::int + ("renewalDocumentId" IS NOT NULL)::int = 1),
  CONSTRAINT "DocumentScan_kind" CHECK ("kind" IN ('contract','appendix','consent') AND ("renewalDocumentId" IS NULL OR "kind" = 'appendix')),
  CONSTRAINT "DocumentScan_size" CHECK ("size" BETWEEN 1 AND 8388608 AND "size" = octet_length("fileData")),
  CONSTRAINT "DocumentScan_mime" CHECK ("mimeType" IN ('application/pdf','image/png','image/jpeg')),
  CONSTRAINT "DocumentScan_review" CHECK ("reviewVersion" >= 0 AND ("reviewVersion" = 0 OR ("reviewedById" IS NOT NULL AND "reviewReason" IS NOT NULL)))
);
CREATE UNIQUE INDEX "DocumentScan_enrollmentDocumentId_kind_digest_key" ON "DocumentScan"("enrollmentDocumentId", "kind", "digest");
CREATE UNIQUE INDEX "DocumentScan_renewalDocumentId_kind_digest_key" ON "DocumentScan"("renewalDocumentId", "kind", "digest");
CREATE FUNCTION protect_document_scan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'document scan original is immutable'; END IF;
  IF (NEW."id", NEW."enrollmentDocumentId", NEW."renewalDocumentId", NEW."kind", NEW."fileName", NEW."mimeType", NEW."size", NEW."digest", NEW."fileData", NEW."uploadedById", NEW."createdAt") IS DISTINCT FROM
     (OLD."id", OLD."enrollmentDocumentId", OLD."renewalDocumentId", OLD."kind", OLD."fileName", OLD."mimeType", OLD."size", OLD."digest", OLD."fileData", OLD."uploadedById", OLD."createdAt")
     OR NEW."reviewVersion" <> OLD."reviewVersion" + 1
  THEN RAISE EXCEPTION 'document scan original is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "DocumentScan_immutable" BEFORE UPDATE OR DELETE ON "DocumentScan"
FOR EACH ROW EXECUTE FUNCTION protect_document_scan();

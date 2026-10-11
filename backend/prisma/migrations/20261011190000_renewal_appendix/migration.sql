CREATE TABLE "RenewalDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renewalId" TEXT NOT NULL UNIQUE REFERENCES "SubscriptionRenewal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "number" SERIAL NOT NULL UNIQUE,
    "templateVersion" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "preparedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedAt" TIMESTAMP(3),
    "signedById" TEXT,
    CONSTRAINT "RenewalDocument_signature" CHECK (("signedAt" IS NULL) = ("signedById" IS NULL))
);
CREATE FUNCTION protect_renewal_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'renewal document is immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['signedAt','signedById']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['signedAt','signedById']) OR OLD."signedAt" IS NOT NULL
  THEN RAISE EXCEPTION 'renewal document is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "RenewalDocument_immutable" BEFORE UPDATE OR DELETE ON "RenewalDocument"
FOR EACH ROW EXECUTE FUNCTION protect_renewal_document();

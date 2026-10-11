ALTER TABLE "Student" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Student" ADD CONSTRAINT "Student_sessionVersion_nonnegative" CHECK ("sessionVersion" >= 0);

-- Cover every password/status writer, including administrative updates and SQL.
CREATE FUNCTION bump_student_session_version() RETURNS trigger AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW."appUserId" IS DISTINCT FROM OLD."appUserId"
     OR NEW."externalLinkStatus" IS DISTINCT FROM OLD."externalLinkStatus" THEN
    NEW."sessionVersion" := OLD."sessionVersion" + 1;
  ELSIF NEW."sessionVersion" < OLD."sessionVersion" THEN
    RAISE EXCEPTION 'Session version cannot decrease';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER student_session_version BEFORE UPDATE ON "Student"
FOR EACH ROW EXECUTE FUNCTION bump_student_session_version();

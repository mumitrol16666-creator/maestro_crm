-- One atomic cutover: capture current amounts without recalculation, then make
-- the ledger the only writer. Stop the old application before applying this.
BEGIN;
LOCK TABLE "Student" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "StudentBalanceEntry" (
    "id" TEXT PRIMARY KEY,
    "studentId" TEXT NOT NULL REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "reversalOfId" TEXT REFERENCES "StudentBalanceEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "StudentBalanceEntry_arithmetic" CHECK ("balanceAfter"::BIGINT - "balanceBefore"::BIGINT = "amount"::BIGINT),
    CONSTRAINT "StudentBalanceEntry_kind" CHECK ("kind" IN ('opening', 'payment', 'payment_correction', 'payment_refund', 'payment_cancellation', 'lesson_charge', 'lesson_reversal', 'manual_adjustment')),
    CONSTRAINT "StudentBalanceEntry_reason" CHECK (length(trim("reason")) > 0),
    CONSTRAINT "StudentBalanceEntry_nonzero" CHECK ("kind" = 'opening' OR "amount" <> 0)
);
CREATE UNIQUE INDEX "StudentBalanceEntry_operationKey_key" ON "StudentBalanceEntry"("operationKey");
CREATE UNIQUE INDEX "StudentBalanceEntry_reversalOfId_key" ON "StudentBalanceEntry"("reversalOfId");
CREATE UNIQUE INDEX "StudentBalanceEntry_studentId_position_key" ON "StudentBalanceEntry"("studentId", "position");
CREATE UNIQUE INDEX "StudentBalanceEntry_one_opening" ON "StudentBalanceEntry"("studentId") WHERE "kind" = 'opening';
CREATE INDEX "StudentBalanceEntry_studentId_sourceType_sourceId_idx" ON "StudentBalanceEntry"("studentId", "sourceType", "sourceId");

INSERT INTO "StudentBalanceEntry" ("id", "studentId", "position", "amount", "balanceBefore", "balanceAfter", "kind", "sourceType", "sourceId", "reason", "operationKey", "requestHash", "needsReview", "metadata")
SELECT 'opening:' || "id", "id", 0, "accountBalance", 0, "accountBalance", 'opening', 'cutover', "id",
       'Начальный остаток при переходе. История до перехода требует сверки.',
       'opening:' || "id", 'cutover', true, '{"origin":"balance_before_ledger","historicalReconciliation":"pending"}'::JSONB
FROM "Student" WHERE "role" = 'student';

CREATE FUNCTION maestro_prepare_balance_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_balance INTEGER; last_balance INTEGER; last_position INTEGER; old_entry "StudentBalanceEntry"%ROWTYPE;
BEGIN
    SELECT "accountBalance" INTO STRICT current_balance FROM "Student" WHERE "id" = NEW."studentId" FOR UPDATE;
    IF NEW."kind" = 'opening' THEN
        IF pg_trigger_depth() <> 2 THEN
            RAISE EXCEPTION 'BALANCE_OPENING_FORBIDDEN: opening is created with the student';
        END IF;
        NEW."position" := 0;
        NEW."amount" := current_balance;
        NEW."balanceBefore" := 0;
        NEW."balanceAfter" := current_balance;
    ELSE
        SELECT "balanceAfter", "position" INTO last_balance, last_position FROM "StudentBalanceEntry"
            WHERE "studentId" = NEW."studentId" ORDER BY "position" DESC LIMIT 1;
        IF NOT FOUND OR last_balance <> current_balance THEN
            RAISE EXCEPTION 'BALANCE_LEDGER_MISMATCH: current balance does not match the journal';
        END IF;
        IF NEW."reversalOfId" IS NOT NULL THEN
            SELECT * INTO STRICT old_entry FROM "StudentBalanceEntry" WHERE "id" = NEW."reversalOfId";
            IF old_entry."studentId" <> NEW."studentId" OR old_entry."amount"::BIGINT + NEW."amount"::BIGINT <> 0
                OR old_entry."kind" <> 'lesson_charge' OR NEW."kind" <> 'lesson_reversal' THEN
                RAISE EXCEPTION 'BALANCE_REVERSAL_INVALID: reversal must match the original lesson charge';
            END IF;
        END IF;
        NEW."position" := last_position + 1;
        NEW."balanceBefore" := current_balance;
        NEW."balanceAfter" := (current_balance::BIGINT + NEW."amount"::BIGINT)::INTEGER;
    END IF;
    NEW."recordedAt" := clock_timestamp();
    RETURN NEW;
END $$;

CREATE FUNCTION maestro_apply_balance_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."kind" <> 'opening' THEN
        UPDATE "Student" SET "accountBalance" = NEW."balanceAfter", "updatedAt" = clock_timestamp() WHERE "id" = NEW."studentId";
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION maestro_guard_account_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."accountBalance" IS DISTINCT FROM OLD."accountBalance" AND pg_trigger_depth() <> 2 THEN
        RAISE EXCEPTION 'BALANCE_LEDGER_REQUIRED: write a balance entry instead of changing accountBalance';
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION maestro_guard_balance_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'BALANCE_HISTORY_IMMUTABLE: use a new correcting entry';
END $$;

CREATE FUNCTION maestro_open_student_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."role" = 'student' AND NOT EXISTS (SELECT 1 FROM "StudentBalanceEntry" WHERE "studentId" = NEW."id") THEN
        INSERT INTO "StudentBalanceEntry" ("id", "studentId", "amount", "kind", "sourceType", "sourceId", "reason", "operationKey", "requestHash", "needsReview", "metadata")
        VALUES ('opening:' || NEW."id", NEW."id", NEW."accountBalance", 'opening', 'student_creation', NEW."id",
            CASE WHEN NEW."accountBalance" = 0 THEN 'Открытие счёта ученика' ELSE 'Начальный остаток созданной карточки требует сверки' END,
            'opening:' || NEW."id", 'student_creation', NEW."accountBalance" <> 0, '{"origin":"student_creation"}'::JSONB);
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER "StudentBalanceEntry_prepare" BEFORE INSERT ON "StudentBalanceEntry" FOR EACH ROW EXECUTE FUNCTION maestro_prepare_balance_entry();
CREATE TRIGGER "StudentBalanceEntry_apply" AFTER INSERT ON "StudentBalanceEntry" FOR EACH ROW EXECUTE FUNCTION maestro_apply_balance_entry();
CREATE TRIGGER "StudentBalanceEntry_immutable" BEFORE UPDATE OR DELETE ON "StudentBalanceEntry" FOR EACH ROW EXECUTE FUNCTION maestro_guard_balance_history();
CREATE TRIGGER "Student_balance_guard" BEFORE UPDATE OF "accountBalance" ON "Student" FOR EACH ROW EXECUTE FUNCTION maestro_guard_account_balance();
CREATE TRIGGER "Student_balance_opening" AFTER INSERT OR UPDATE OF "role" ON "Student" FOR EACH ROW EXECUTE FUNCTION maestro_open_student_balance();
COMMIT;

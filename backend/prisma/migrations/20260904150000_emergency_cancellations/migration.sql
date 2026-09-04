-- Экстренная отмена сохраняет один поздно отменённый урок и не является
-- заморозкой всего периода абонемента.
ALTER TABLE "DirectionPlan"
ADD COLUMN "emergencyFreezes" INTEGER NOT NULL DEFAULT 0;

-- Устаревшие индивидуальные позиции остаются в истории, но больше не
-- предлагаются при новой продаже.
UPDATE "DirectionPlan"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" IN (
    'individual_1_2',
    'individual_2_2',
    'individual_4_long',
    'individual_4',
    'individual_8_25',
    'individual_year'
)
AND "directionId" IN (
    SELECT "id" FROM "Direction"
    WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Фортепиано', 'Укулеле')
);

-- Актуальная линейка индивидуального обучения доступна на всех направлениях,
-- где индивидуальные пакеты уже продавались.
UPDATE "DirectionPlan" p
SET "label" = v."label",
    "classes" = v."classes",
    "days" = v."days",
    "price" = v."price",
    "lessonFormat" = 'individual',
    "durationMinutes" = 45,
    "individualClasses" = NULL,
    "groupClasses" = NULL,
    "theoryClasses" = NULL,
    "emergencyFreezes" = v."emergencyFreezes",
    "order" = v."sortOrder",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
    ('individual_1', 'Индивидуально · 1 месяц', 8, 31, 32000, 0, 30),
    ('individual_2', 'Индивидуально · 2 месяца', 16, 60, 62000, 2, 31),
    ('individual_3', 'Индивидуально · 3 месяца', 24, 90, 90000, 3, 32),
    ('individual_6m', 'Индивидуально · 6 месяцев', 48, 180, 180000, 6, 33),
    ('individual_10m', 'Индивидуально · 10 месяцев', 80, 305, 300000, 10, 34)
) AS v("type", "label", "classes", "days", "price", "emergencyFreezes", "sortOrder")
WHERE p."type" = v."type"
  AND p."directionId" IN (
      SELECT "id" FROM "Direction"
      WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Укулеле')
  );

INSERT INTO "DirectionPlan" (
    "id", "directionId", "label", "type", "classes", "days", "price",
    "lessonFormat", "durationMinutes", "emergencyFreezes", "order", "isActive",
    "createdAt", "updatedAt"
)
SELECT
    v."type" || '_' || substr(md5(d."id"), 1, 16),
    d."id", v."label", v."type", v."classes", v."days", v."price",
    'individual', 45, v."emergencyFreezes", v."sortOrder", true,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Direction" d
CROSS JOIN (VALUES
    ('individual_1', 'Индивидуально · 1 месяц', 8, 31, 32000, 0, 30),
    ('individual_2', 'Индивидуально · 2 месяца', 16, 60, 62000, 2, 31),
    ('individual_3', 'Индивидуально · 3 месяца', 24, 90, 90000, 3, 32),
    ('individual_6m', 'Индивидуально · 6 месяцев', 48, 180, 180000, 6, 33),
    ('individual_10m', 'Индивидуально · 10 месяцев', 80, 305, 300000, 10, 34)
) AS v("type", "label", "classes", "days", "price", "emergencyFreezes", "sortOrder")
WHERE d."name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Укулеле')
  AND NOT EXISTS (
      SELECT 1 FROM "DirectionPlan" p
      WHERE p."directionId" = d."id" AND p."type" = v."type"
  );

-- Duo следует тем же правилам экстренных отмен, что и индивидуальный формат.
UPDATE "DirectionPlan" p
SET "label" = v."label",
    "classes" = v."classes",
    "days" = v."days",
    "price" = v."price",
    "lessonFormat" = 'group',
    "durationMinutes" = 45,
    "individualClasses" = NULL,
    "groupClasses" = NULL,
    "theoryClasses" = NULL,
    "emergencyFreezes" = v."emergencyFreezes",
    "order" = v."sortOrder",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
    ('duet', 'Дуо · 1 месяц', 8, 31, 22000, 0, 20),
    ('duet_2m', 'Дуо · 2 месяца', 16, 60, 40000, 2, 21),
    ('duet_3m', 'Дуо · 3 месяца', 24, 90, 60000, 3, 22)
) AS v("type", "label", "classes", "days", "price", "emergencyFreezes", "sortOrder")
WHERE p."type" = v."type"
  AND p."directionId" IN (
      SELECT "id" FROM "Direction"
      WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Укулеле')
  );

INSERT INTO "DirectionPlan" (
    "id", "directionId", "label", "type", "classes", "days", "price",
    "lessonFormat", "durationMinutes", "emergencyFreezes", "order", "isActive",
    "createdAt", "updatedAt"
)
SELECT
    v."type" || '_' || substr(md5(d."id"), 1, 16),
    d."id", v."label", v."type", v."classes", v."days", v."price",
    'group', 45, v."emergencyFreezes", v."sortOrder", true,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Direction" d
CROSS JOIN (VALUES
    ('duet', 'Дуо · 1 месяц', 8, 31, 22000, 0, 20),
    ('duet_2m', 'Дуо · 2 месяца', 16, 60, 40000, 2, 21),
    ('duet_3m', 'Дуо · 3 месяца', 24, 90, 60000, 3, 22)
) AS v("type", "label", "classes", "days", "price", "emergencyFreezes", "sortOrder")
WHERE d."name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Укулеле')
  AND NOT EXISTS (
      SELECT 1 FROM "DirectionPlan" p
      WHERE p."directionId" = d."id" AND p."type" = v."type"
  );

-- Гибрид продаётся только на гитаре, электрогитаре и бас-гитаре. В частности,
-- у укулеле гибридные позиции отключаются без удаления старой истории.
UPDATE "DirectionPlan"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" LIKE 'hybrid_%'
  AND "directionId" NOT IN (
      SELECT "id" FROM "Direction"
      WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара')
  );

-- Теория и квартет — компоненты гитарного гибрида. Они не должны случайно
-- появляться как отдельный тариф у вокала, фортепиано или укулеле.
UPDATE "DirectionPlan"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" IN ('theory', 'quartet_only')
  AND "directionId" NOT IN (
      SELECT "id" FROM "Direction"
      WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара')
  );

UPDATE "DirectionPlan"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'hybrid_1';

UPDATE "DirectionPlan" p
SET "label" = v."label",
    "classes" = v."classes",
    "days" = v."days",
    "price" = v."price",
    "lessonFormat" = 'mixed',
    "durationMinutes" = 45,
    "individualClasses" = v."individualClasses",
    "groupClasses" = v."groupClasses",
    "theoryClasses" = v."theoryClasses",
    "emergencyFreezes" = v."emergencyFreezes",
    "order" = v."sortOrder",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
    ('hybrid_1m', 'Гибридный формат · 1 месяц', 10, 31, 27000, 4, 4, 2, 0, 10),
    ('hybrid_2m', 'Гибридный формат · 2 месяца', 20, 60, 50000, 8, 8, 4, 1, 11),
    ('hybrid_3m', 'Гибридный формат · 3 месяца', 30, 90, 75000, 12, 12, 6, 2, 12),
    ('hybrid_6m', 'Гибридный формат · 6 месяцев', 60, 180, 150000, 24, 24, 12, 3, 13),
    ('hybrid_10m', 'Гибридный формат · 10 месяцев', 100, 305, 250000, 40, 40, 20, 5, 14)
) AS v(
    "type", "label", "classes", "days", "price", "individualClasses",
    "groupClasses", "theoryClasses", "emergencyFreezes", "sortOrder"
)
WHERE p."type" = v."type"
  AND p."directionId" IN (
      SELECT "id" FROM "Direction"
      WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара')
  );

INSERT INTO "DirectionPlan" (
    "id", "directionId", "label", "type", "classes", "days", "price",
    "lessonFormat", "durationMinutes", "individualClasses", "groupClasses",
    "theoryClasses", "emergencyFreezes", "order", "isActive", "createdAt", "updatedAt"
)
SELECT
    v."type" || '_' || substr(md5(d."id"), 1, 16),
    d."id", v."label", v."type", v."classes", v."days", v."price",
    'mixed', 45, v."individualClasses", v."groupClasses", v."theoryClasses",
    v."emergencyFreezes", v."sortOrder", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Direction" d
CROSS JOIN (VALUES
    ('hybrid_1m', 'Гибридный формат · 1 месяц', 10, 31, 27000, 4, 4, 2, 0, 10),
    ('hybrid_2m', 'Гибридный формат · 2 месяца', 20, 60, 50000, 8, 8, 4, 1, 11),
    ('hybrid_3m', 'Гибридный формат · 3 месяца', 30, 90, 75000, 12, 12, 6, 2, 12),
    ('hybrid_6m', 'Гибридный формат · 6 месяцев', 60, 180, 150000, 24, 24, 12, 3, 13),
    ('hybrid_10m', 'Гибридный формат · 10 месяцев', 100, 305, 250000, 40, 40, 20, 5, 14)
) AS v(
    "type", "label", "classes", "days", "price", "individualClasses",
    "groupClasses", "theoryClasses", "emergencyFreezes", "sortOrder"
)
WHERE d."name" IN ('Гитара', 'Электрогитара', 'Басгитара')
  AND NOT EXISTS (
      SELECT 1 FROM "DirectionPlan" p
      WHERE p."directionId" = d."id" AND p."type" = v."type"
  );

-- Шаблоны MembershipPlan получают те же лимиты; обычная заморозка периода не
-- должна автоматически входить в тариф.
UPDATE "MembershipPlan" mp
SET "emergencyFreezes" = dp."emergencyFreezes",
    "freezePolicy" = '{"maxFreezes":0}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "DirectionPlan" dp
WHERE mp."directionPlanId" = dp."id";

-- Выдаём новый лимит уже активным абонементам только там, где экстренные
-- отмены ещё не использовались и лимит прежде не был настроен вручную.
UPDATE "Membership"
SET "emergencyFreezesAvailable" = CASE "type"
        WHEN 'individual_2' THEN 2
        WHEN 'individual_3' THEN 3
        WHEN 'individual_6m' THEN 6
        WHEN 'individual_10m' THEN 10
        WHEN 'individual_year' THEN 10
        WHEN 'duet_2m' THEN 2
        WHEN 'duet_3m' THEN 3
        WHEN 'hybrid_2m' THEN 1
        WHEN 'hybrid_3m' THEN 2
        WHEN 'hybrid_6m' THEN 3
        WHEN 'hybrid_10m' THEN 5
        ELSE COALESCE("emergencyFreezesAvailable", 0)
    END,
    "emergencyFreezesUsed" = COALESCE("emergencyFreezesUsed", 0),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('active', 'frozen')
  AND COALESCE("emergencyFreezesAvailable", 0) = 0
  AND COALESCE("emergencyFreezesUsed", 0) = 0;

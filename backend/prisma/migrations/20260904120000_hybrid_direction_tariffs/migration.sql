-- Старый технический гибрид остаётся у уже созданных абонементов, но больше
-- не предлагается при новой продаже.
UPDATE "DirectionPlan"
SET "label" = 'Гибрид 1 (архивный)',
    "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'hybrid_1';

-- Актуальные гибридные пакеты продаются только для гитарных направлений.
UPDATE "DirectionPlan"
SET "label" = 'Гибридный формат · 1 месяц',
    "classes" = 10,
    "days" = 31,
    "price" = 27000,
    "lessonFormat" = 'mixed',
    "durationMinutes" = 45,
    "individualClasses" = 4,
    "groupClasses" = 4,
    "theoryClasses" = 2,
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'hybrid_1m'
  AND "directionId" IN (
      SELECT "id" FROM "Direction"
      WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Укулеле')
  );

INSERT INTO "DirectionPlan" (
    "id", "directionId", "label", "type", "classes", "days", "price",
    "lessonFormat", "durationMinutes", "individualClasses", "groupClasses",
    "theoryClasses", "order", "isActive", "createdAt", "updatedAt"
)
SELECT
    'hybrid1m_' || substr(md5(d."id"), 1, 16), d."id",
    'Гибридный формат · 1 месяц', 'hybrid_1m', 10, 31, 27000,
    'mixed', 45, 4, 4, 2, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Direction" d
WHERE d."name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Укулеле')
  AND NOT EXISTS (
      SELECT 1 FROM "DirectionPlan" p
      WHERE p."directionId" = d."id" AND p."type" = 'hybrid_1m'
  );

UPDATE "DirectionPlan"
SET "label" = 'Гибридный формат · 2 месяца',
    "classes" = 20,
    "days" = 60,
    "price" = 50000,
    "lessonFormat" = 'mixed',
    "durationMinutes" = 45,
    "individualClasses" = 8,
    "groupClasses" = 8,
    "theoryClasses" = 4,
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'hybrid_2m'
  AND "directionId" IN (
      SELECT "id" FROM "Direction"
      WHERE "name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Укулеле')
  );

INSERT INTO "DirectionPlan" (
    "id", "directionId", "label", "type", "classes", "days", "price",
    "lessonFormat", "durationMinutes", "individualClasses", "groupClasses",
    "theoryClasses", "order", "isActive", "createdAt", "updatedAt"
)
SELECT
    'hybrid2m_' || substr(md5(d."id"), 1, 16), d."id",
    'Гибридный формат · 2 месяца', 'hybrid_2m', 20, 60, 50000,
    'mixed', 45, 8, 8, 4, 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Direction" d
WHERE d."name" IN ('Гитара', 'Электрогитара', 'Басгитара', 'Укулеле')
  AND NOT EXISTS (
      SELECT 1 FROM "DirectionPlan" p
      WHERE p."directionId" = d."id" AND p."type" = 'hybrid_2m'
  );

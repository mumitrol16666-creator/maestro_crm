-- Read-only diagnostic, not an instruction to correct balances automatically.
-- psql -X "$DATABASE_URL" -v as_of='2026-09-23T12:00:00Z' -v lookback_days=60 -f scripts/audit-lesson-charges.sql
-- as_of/ lookback_days bound lesson searches; wallet reconciliation uses the entire
-- CURRENT snapshot, not a reconstructed historical wallet. No row limit on export.
\set ON_ERROR_STOP on
\if :{?as_of}
\else
SELECT now()::text AS as_of \gset
\endif
\if :{?lookback_days}
\else
\set lookback_days 60
\endif
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';

\echo '=== 1. Wallet residual: recorded history, not proof of missing money'
WITH pay AS (
 SELECT "studentId", SUM(CASE WHEN status='completed' THEN amount WHEN status='refunded' THEN -amount ELSE 0 END) AS net FROM "Payment" GROUP BY 1
), chg AS (
 SELECT "studentId", SUM("chargeAmount") AS charged FROM "ClassAttendee" WHERE "studentId" IS NOT NULL GROUP BY 1
), adjustment_rows AS (
 SELECT "entityId", CASE WHEN metadata->>'amount' ~ '^-?[0-9]+$' THEN (metadata->>'amount')::numeric END AS amount
 FROM "ActivityLog" WHERE action='balance_adjustment' AND "entityType"='Student'
), adj AS (
 SELECT "entityId", SUM(amount) AS amount, COUNT(*) FILTER (WHERE amount IS NULL) AS unknown_adjustments FROM adjustment_rows GROUP BY 1
)
SELECT s.id AS student_id, s."lastName", s.name, s.status, s."accountBalance" AS balance,
 COALESCE(p.net,0)-COALESCE(c.charged,0)+COALESCE(a.amount,0) AS recorded_net,
 s."accountBalance"-(COALESCE(p.net,0)-COALESCE(c.charged,0)+COALESCE(a.amount,0)) AS unexplained_opening_or_legacy_balance,
 COALESCE(a.amount,0) AS manual_adjustments, COALESCE(a.unknown_adjustments,0) AS unknown_adjustments,
 CASE WHEN COALESCE(a.unknown_adjustments,0)>0 THEN 'incomplete_adjustment_history'
      WHEN s.status='inactive' THEN 'review_departure_or_opening_balance'
      ELSE 'review_opening_balance_or_unrecorded_reset' END AS review_reason
FROM "Student" s LEFT JOIN pay p ON p."studentId"=s.id LEFT JOIN chg c ON c."studentId"=s.id LEFT JOIN adj a ON a."entityId"=s.id
WHERE s.role='student' AND (s."accountBalance" <> COALESCE(p.net,0)-COALESCE(c.charged,0)+COALESCE(a.amount,0) OR COALESCE(a.unknown_adjustments,0)>0)
ORDER BY ABS(s."accountBalance"-(COALESCE(p.net,0)-COALESCE(c.charged,0)+COALESCE(a.amount,0))) DESC, s.id;

\echo '=== 2. Different participant prices: discounts/free rates may be legitimate'
WITH attendee_evidence AS (
 SELECT a.*, c.date, c.title, c.status AS class_status, c."classType", c."isPractice", c."groupId",
        s.name, s."lastName", m.type, m."lessonFormat", m."totalPrice", m."basePrice", m."discountPercent", m."totalClasses", m."lessonPrice",
        m."groupLessonPrice", m."individualLessonPrice", m."theoryLessonPrice",
        to_jsonb(m)->>'billingModel' AS billing_model, to_jsonb(m)->'lessonRates' AS rate_card,
        CASE WHEN c."classType" = 'individual' THEN m."individualLessonPrice"
             WHEN c."classType" = 'theory' THEN m."theoryLessonPrice" ELSE m."groupLessonPrice" END AS saved_price,
        CASE WHEN m."lessonPrice" > 0 THEN m."lessonPrice"
             WHEN m."totalClasses" > 0 AND (m."totalPrice" > 0 OR (m."totalPrice" = 0 AND m."basePrice" > 0))
             THEN ROUND(m."totalPrice"::numeric / m."totalClasses") END AS purchase_price,
        COALESCE(e.net_events,0) AS net_events, e.net_money, COALESCE(e.has_free_event,false) AS has_free_event,
        e.membership_ids
 FROM "ClassAttendee" a
 JOIN "Class" c ON c.id = a."classId"
 JOIN "Student" s ON s.id = a."studentId"
 LEFT JOIN "Membership" m ON m.id = a."chargedMembershipId" AND m."studentId" = a."studentId"
 LEFT JOIN LATERAL (
   SELECT SUM(n.net_events) AS net_events, SUM(n.net_money) AS net_money,
          BOOL_OR(n.net_events > 0 AND n.net_money = 0 AND n.known_money) AS has_free_event,
          array_agg(n."membershipId" ORDER BY n."membershipId") AS membership_ids
   FROM (
     SELECT t."membershipId",
       CASE WHEN BOOL_OR(t.amount > 0) THEN SUM(CASE WHEN t.type = 'add' THEN -t.amount ELSE t.amount END)
            ELSE SUM(CASE WHEN t.type = 'add' THEN -1 ELSE 1 END) END AS net_events,
       SUM(CASE WHEN t.type = 'add' THEN -t."chargeAmount" ELSE t."chargeAmount" END) AS net_money,
       BOOL_AND(t."chargeAmount" IS NOT NULL) AS known_money
     FROM "MembershipTransaction" t JOIN "Membership" tm ON tm.id = t."membershipId"
     WHERE t."classId" = c.id AND tm."studentId" = a."studentId" AND t.type IN ('deduct','manual_deduct','add')
     GROUP BY t."membershipId"
   ) n
 ) e ON true
 WHERE c.date >= :'as_of'::timestamptz - make_interval(days => :'lookback_days'::int)
   AND c.date <= :'as_of'::timestamptz
   AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."trialClassId" = c.id)
), evidence AS (
 SELECT *, COALESCE(saved_price,purchase_price) AS expected_price
 FROM attendee_evidence
)
SELECT "classId" AS class_id, date, "groupId" AS group_id,
 jsonb_agg(jsonb_build_object('studentId',"studentId",'attendeeId',id,'membershipId',"chargedMembershipId",'amount',"chargeAmount",'source',"chargeSource",'savedPrice',saved_price,'purchasePrice',purchase_price,'ratesForReview',rate_card) ORDER BY "studentId") AS participants
FROM evidence WHERE class_status='completed' AND "groupId" IS NOT NULL AND "attendanceStatus" IN ('present','late','unexcused_absence')
GROUP BY "classId",date,"groupId" HAVING COUNT(DISTINCT "chargeAmount")>1 ORDER BY date DESC,"classId";

\echo '=== 3. Possible legacy 1200 fallback, including discounts: review source before correction'
WITH attendee_evidence AS (
 SELECT a.*, c.date, c.title, c.status AS class_status, c."classType", c."isPractice", c."groupId",
        s.name, s."lastName", m.type, m."lessonFormat", m."totalPrice", m."basePrice", m."discountPercent", m."totalClasses", m."lessonPrice",
        m."groupLessonPrice", m."individualLessonPrice", m."theoryLessonPrice",
        to_jsonb(m)->>'billingModel' AS billing_model, to_jsonb(m)->'lessonRates' AS rate_card,
        CASE WHEN c."classType" = 'individual' THEN m."individualLessonPrice"
             WHEN c."classType" = 'theory' THEN m."theoryLessonPrice" ELSE m."groupLessonPrice" END AS saved_price,
        CASE WHEN m."lessonPrice" > 0 THEN m."lessonPrice"
             WHEN m."totalClasses" > 0 AND (m."totalPrice" > 0 OR (m."totalPrice" = 0 AND m."basePrice" > 0))
             THEN ROUND(m."totalPrice"::numeric / m."totalClasses") END AS purchase_price,
        COALESCE(e.net_events,0) AS net_events, e.net_money, COALESCE(e.has_free_event,false) AS has_free_event,
        e.membership_ids
 FROM "ClassAttendee" a
 JOIN "Class" c ON c.id = a."classId"
 JOIN "Student" s ON s.id = a."studentId"
 LEFT JOIN "Membership" m ON m.id = a."chargedMembershipId" AND m."studentId" = a."studentId"
 LEFT JOIN LATERAL (
   SELECT SUM(n.net_events) AS net_events, SUM(n.net_money) AS net_money,
          BOOL_OR(n.net_events > 0 AND n.net_money = 0 AND n.known_money) AS has_free_event,
          array_agg(n."membershipId" ORDER BY n."membershipId") AS membership_ids
   FROM (
     SELECT t."membershipId",
       CASE WHEN BOOL_OR(t.amount > 0) THEN SUM(CASE WHEN t.type = 'add' THEN -t.amount ELSE t.amount END)
            ELSE SUM(CASE WHEN t.type = 'add' THEN -1 ELSE 1 END) END AS net_events,
       SUM(CASE WHEN t.type = 'add' THEN -t."chargeAmount" ELSE t."chargeAmount" END) AS net_money,
       BOOL_AND(t."chargeAmount" IS NOT NULL) AS known_money
     FROM "MembershipTransaction" t JOIN "Membership" tm ON tm.id = t."membershipId"
     WHERE t."classId" = c.id AND tm."studentId" = a."studentId" AND t.type IN ('deduct','manual_deduct','add')
     GROUP BY t."membershipId"
   ) n
 ) e ON true
 WHERE c.date >= :'as_of'::timestamptz - make_interval(days => :'lookback_days'::int)
   AND c.date <= :'as_of'::timestamptz
   AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."trialClassId" = c.id)
), evidence AS (
 SELECT *, COALESCE(saved_price,purchase_price) AS expected_price
 FROM attendee_evidence
)
SELECT "classId" AS class_id, "studentId" AS student_id, id AS attendee_id, "chargedMembershipId" AS membership_id,
 date, "chargeAmount", expected_price, type, 'possible_legacy_fallback' AS review_reason
FROM evidence WHERE class_status='completed' AND "classType"='group' AND "lessonFormat"='group'
 AND COALESCE(billing_model,'legacy')<>'rate_card' AND "attendanceStatus" IN ('present','late','unexcused_absence')
 AND "chargeAmount">0 AND "chargeAmount"=ROUND(1200 * CASE
   WHEN "basePrice">0 AND "totalPrice">=0 AND "totalPrice"<"basePrice" THEN "totalPrice"::numeric/"basePrice"
   WHEN "discountPercent">0 THEN (100-LEAST(100,"discountPercent"))::numeric/100 ELSE 1 END)
 AND (expected_price IS NULL OR "chargeAmount"<>expected_price) ORDER BY date DESC,id;

\echo '=== 4. Legacy homogeneous price mismatch: exclude free attendance and mixed programs'
WITH attendee_evidence AS (
 SELECT a.*, c.date, c.title, c.status AS class_status, c."classType", c."isPractice", c."groupId",
        s.name, s."lastName", m.type, m."lessonFormat", m."totalPrice", m."basePrice", m."discountPercent", m."totalClasses", m."lessonPrice",
        m."groupLessonPrice", m."individualLessonPrice", m."theoryLessonPrice",
        to_jsonb(m)->>'billingModel' AS billing_model, to_jsonb(m)->'lessonRates' AS rate_card,
        CASE WHEN c."classType" = 'individual' THEN m."individualLessonPrice"
             WHEN c."classType" = 'theory' THEN m."theoryLessonPrice" ELSE m."groupLessonPrice" END AS saved_price,
        CASE WHEN m."lessonPrice" > 0 THEN m."lessonPrice"
             WHEN m."totalClasses" > 0 AND (m."totalPrice" > 0 OR (m."totalPrice" = 0 AND m."basePrice" > 0))
             THEN ROUND(m."totalPrice"::numeric / m."totalClasses") END AS purchase_price,
        COALESCE(e.net_events,0) AS net_events, e.net_money, COALESCE(e.has_free_event,false) AS has_free_event,
        e.membership_ids
 FROM "ClassAttendee" a
 JOIN "Class" c ON c.id = a."classId"
 JOIN "Student" s ON s.id = a."studentId"
 LEFT JOIN "Membership" m ON m.id = a."chargedMembershipId" AND m."studentId" = a."studentId"
 LEFT JOIN LATERAL (
   SELECT SUM(n.net_events) AS net_events, SUM(n.net_money) AS net_money,
          BOOL_OR(n.net_events > 0 AND n.net_money = 0 AND n.known_money) AS has_free_event,
          array_agg(n."membershipId" ORDER BY n."membershipId") AS membership_ids
   FROM (
     SELECT t."membershipId",
       CASE WHEN BOOL_OR(t.amount > 0) THEN SUM(CASE WHEN t.type = 'add' THEN -t.amount ELSE t.amount END)
            ELSE SUM(CASE WHEN t.type = 'add' THEN -1 ELSE 1 END) END AS net_events,
       SUM(CASE WHEN t.type = 'add' THEN -t."chargeAmount" ELSE t."chargeAmount" END) AS net_money,
       BOOL_AND(t."chargeAmount" IS NOT NULL) AS known_money
     FROM "MembershipTransaction" t JOIN "Membership" tm ON tm.id = t."membershipId"
     WHERE t."classId" = c.id AND tm."studentId" = a."studentId" AND t.type IN ('deduct','manual_deduct','add')
     GROUP BY t."membershipId"
   ) n
 ) e ON true
 WHERE c.date >= :'as_of'::timestamptz - make_interval(days => :'lookback_days'::int)
   AND c.date <= :'as_of'::timestamptz
   AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."trialClassId" = c.id)
), evidence AS (
 SELECT *, COALESCE(saved_price,purchase_price) AS expected_price
 FROM attendee_evidence
)
SELECT "classId" AS class_id, "studentId" AS student_id, id AS attendee_id, "chargedMembershipId" AS membership_id,
 date, "chargeAmount", expected_price, saved_price, purchase_price, type,
 'verify_historical_purchase_terms' AS review_reason
FROM evidence WHERE class_status='completed' AND "classType" IN ('group','theory','individual')
 AND "lessonFormat" IN ('group','individual') AND COALESCE(type,'') NOT LIKE 'hybrid%'
 AND COALESCE(billing_model,'legacy')<>'rate_card' AND NOT "isPractice"
 AND "attendanceStatus" IN ('present','late','unexcused_absence') AND expected_price IS NOT NULL
 AND "chargeAmount"<>expected_price
 -- Budget-driven individual lessons may legitimately distribute rounding.
 AND "classType"<>'individual'
 ORDER BY date DESC,id;

\echo '=== 5. Cancelled charged absence without money; per-student net events, no join multiplication'
WITH attendee_evidence AS (
 SELECT a.*, c.date, c.title, c.status AS class_status, c."classType", c."isPractice", c."groupId",
        s.name, s."lastName", m.type, m."lessonFormat", m."totalPrice", m."basePrice", m."discountPercent", m."totalClasses", m."lessonPrice",
        m."groupLessonPrice", m."individualLessonPrice", m."theoryLessonPrice",
        to_jsonb(m)->>'billingModel' AS billing_model, to_jsonb(m)->'lessonRates' AS rate_card,
        CASE WHEN c."classType" = 'individual' THEN m."individualLessonPrice"
             WHEN c."classType" = 'theory' THEN m."theoryLessonPrice" ELSE m."groupLessonPrice" END AS saved_price,
        CASE WHEN m."lessonPrice" > 0 THEN m."lessonPrice"
             WHEN m."totalClasses" > 0 AND (m."totalPrice" > 0 OR (m."totalPrice" = 0 AND m."basePrice" > 0))
             THEN ROUND(m."totalPrice"::numeric / m."totalClasses") END AS purchase_price,
        COALESCE(e.net_events,0) AS net_events, e.net_money, COALESCE(e.has_free_event,false) AS has_free_event,
        e.membership_ids
 FROM "ClassAttendee" a
 JOIN "Class" c ON c.id = a."classId"
 JOIN "Student" s ON s.id = a."studentId"
 LEFT JOIN "Membership" m ON m.id = a."chargedMembershipId" AND m."studentId" = a."studentId"
 LEFT JOIN LATERAL (
   SELECT SUM(n.net_events) AS net_events, SUM(n.net_money) AS net_money,
          BOOL_OR(n.net_events > 0 AND n.net_money = 0 AND n.known_money) AS has_free_event,
          array_agg(n."membershipId" ORDER BY n."membershipId") AS membership_ids
   FROM (
     SELECT t."membershipId",
       CASE WHEN BOOL_OR(t.amount > 0) THEN SUM(CASE WHEN t.type = 'add' THEN -t.amount ELSE t.amount END)
            ELSE SUM(CASE WHEN t.type = 'add' THEN -1 ELSE 1 END) END AS net_events,
       SUM(CASE WHEN t.type = 'add' THEN -t."chargeAmount" ELSE t."chargeAmount" END) AS net_money,
       BOOL_AND(t."chargeAmount" IS NOT NULL) AS known_money
     FROM "MembershipTransaction" t JOIN "Membership" tm ON tm.id = t."membershipId"
     WHERE t."classId" = c.id AND tm."studentId" = a."studentId" AND t.type IN ('deduct','manual_deduct','add')
     GROUP BY t."membershipId"
   ) n
 ) e ON true
 WHERE c.date >= :'as_of'::timestamptz - make_interval(days => :'lookback_days'::int)
   AND c.date <= :'as_of'::timestamptz
   AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."trialClassId" = c.id)
), evidence AS (
 SELECT *, COALESCE(saved_price,purchase_price) AS expected_price
 FROM attendee_evidence
)
SELECT "classId" AS class_id, "studentId" AS student_id, id AS attendee_id, date,
 "autoDeducted", "chargeAmount", net_events, net_money, membership_ids, 'review_unpaid_cancellation' AS review_reason
FROM evidence WHERE class_status='cancelled' AND "attendanceStatus"='unexcused_absence' AND "chargeAmount"=0
 AND NOT "isPractice" AND "classType"<>'trial' AND (net_events>0 OR ("autoDeducted" AND membership_ids IS NULL))
 AND NOT has_free_event AND NOT (COALESCE(expected_price,-1)=0 AND net_events>0)
 ORDER BY date DESC,id;

\echo '=== 6. Balance-only charges: review authorization, not automatically an error'
WITH attendee_evidence AS (
 SELECT a.*, c.date, c.title, c.status AS class_status, c."classType", c."isPractice", c."groupId",
        s.name, s."lastName", m.type, m."lessonFormat", m."totalPrice", m."basePrice", m."discountPercent", m."totalClasses", m."lessonPrice",
        m."groupLessonPrice", m."individualLessonPrice", m."theoryLessonPrice",
        to_jsonb(m)->>'billingModel' AS billing_model, to_jsonb(m)->'lessonRates' AS rate_card,
        CASE WHEN c."classType" = 'individual' THEN m."individualLessonPrice"
             WHEN c."classType" = 'theory' THEN m."theoryLessonPrice" ELSE m."groupLessonPrice" END AS saved_price,
        CASE WHEN m."lessonPrice" > 0 THEN m."lessonPrice"
             WHEN m."totalClasses" > 0 AND (m."totalPrice" > 0 OR (m."totalPrice" = 0 AND m."basePrice" > 0))
             THEN ROUND(m."totalPrice"::numeric / m."totalClasses") END AS purchase_price,
        COALESCE(e.net_events,0) AS net_events, e.net_money, COALESCE(e.has_free_event,false) AS has_free_event,
        e.membership_ids
 FROM "ClassAttendee" a
 JOIN "Class" c ON c.id = a."classId"
 JOIN "Student" s ON s.id = a."studentId"
 LEFT JOIN "Membership" m ON m.id = a."chargedMembershipId" AND m."studentId" = a."studentId"
 LEFT JOIN LATERAL (
   SELECT SUM(n.net_events) AS net_events, SUM(n.net_money) AS net_money,
          BOOL_OR(n.net_events > 0 AND n.net_money = 0 AND n.known_money) AS has_free_event,
          array_agg(n."membershipId" ORDER BY n."membershipId") AS membership_ids
   FROM (
     SELECT t."membershipId",
       CASE WHEN BOOL_OR(t.amount > 0) THEN SUM(CASE WHEN t.type = 'add' THEN -t.amount ELSE t.amount END)
            ELSE SUM(CASE WHEN t.type = 'add' THEN -1 ELSE 1 END) END AS net_events,
       SUM(CASE WHEN t.type = 'add' THEN -t."chargeAmount" ELSE t."chargeAmount" END) AS net_money,
       BOOL_AND(t."chargeAmount" IS NOT NULL) AS known_money
     FROM "MembershipTransaction" t JOIN "Membership" tm ON tm.id = t."membershipId"
     WHERE t."classId" = c.id AND tm."studentId" = a."studentId" AND t.type IN ('deduct','manual_deduct','add')
     GROUP BY t."membershipId"
   ) n
 ) e ON true
 WHERE c.date >= :'as_of'::timestamptz - make_interval(days => :'lookback_days'::int)
   AND c.date <= :'as_of'::timestamptz
   AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."trialClassId" = c.id)
), evidence AS (
 SELECT *, COALESCE(saved_price,purchase_price) AS expected_price
 FROM attendee_evidence
)
SELECT "classId" AS class_id, "studentId" AS student_id, id AS attendee_id, date, "classType", "chargeAmount", class_status
FROM evidence WHERE "chargeSource"='balance_only' ORDER BY date DESC,id;

\echo '=== 7. Each chargeable participant without a recorded charge (including unexcused absence)'
WITH attendee_evidence AS (
 SELECT a.*, c.date, c.title, c.status AS class_status, c."classType", c."isPractice", c."groupId",
        s.name, s."lastName", m.type, m."lessonFormat", m."totalPrice", m."basePrice", m."discountPercent", m."totalClasses", m."lessonPrice",
        m."groupLessonPrice", m."individualLessonPrice", m."theoryLessonPrice",
        to_jsonb(m)->>'billingModel' AS billing_model, to_jsonb(m)->'lessonRates' AS rate_card,
        CASE WHEN c."classType" = 'individual' THEN m."individualLessonPrice"
             WHEN c."classType" = 'theory' THEN m."theoryLessonPrice" ELSE m."groupLessonPrice" END AS saved_price,
        CASE WHEN m."lessonPrice" > 0 THEN m."lessonPrice"
             WHEN m."totalClasses" > 0 AND (m."totalPrice" > 0 OR (m."totalPrice" = 0 AND m."basePrice" > 0))
             THEN ROUND(m."totalPrice"::numeric / m."totalClasses") END AS purchase_price,
        COALESCE(e.net_events,0) AS net_events, e.net_money, COALESCE(e.has_free_event,false) AS has_free_event,
        e.membership_ids
 FROM "ClassAttendee" a
 JOIN "Class" c ON c.id = a."classId"
 JOIN "Student" s ON s.id = a."studentId"
 LEFT JOIN "Membership" m ON m.id = a."chargedMembershipId" AND m."studentId" = a."studentId"
 LEFT JOIN LATERAL (
   SELECT SUM(n.net_events) AS net_events, SUM(n.net_money) AS net_money,
          BOOL_OR(n.net_events > 0 AND n.net_money = 0 AND n.known_money) AS has_free_event,
          array_agg(n."membershipId" ORDER BY n."membershipId") AS membership_ids
   FROM (
     SELECT t."membershipId",
       CASE WHEN BOOL_OR(t.amount > 0) THEN SUM(CASE WHEN t.type = 'add' THEN -t.amount ELSE t.amount END)
            ELSE SUM(CASE WHEN t.type = 'add' THEN -1 ELSE 1 END) END AS net_events,
       SUM(CASE WHEN t.type = 'add' THEN -t."chargeAmount" ELSE t."chargeAmount" END) AS net_money,
       BOOL_AND(t."chargeAmount" IS NOT NULL) AS known_money
     FROM "MembershipTransaction" t JOIN "Membership" tm ON tm.id = t."membershipId"
     WHERE t."classId" = c.id AND tm."studentId" = a."studentId" AND t.type IN ('deduct','manual_deduct','add')
     GROUP BY t."membershipId"
   ) n
 ) e ON true
 WHERE c.date >= :'as_of'::timestamptz - make_interval(days => :'lookback_days'::int)
   AND c.date <= :'as_of'::timestamptz
   AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."trialClassId" = c.id)
), evidence AS (
 SELECT *, COALESCE(saved_price,purchase_price) AS expected_price
 FROM attendee_evidence
)
SELECT "classId" AS class_id, "studentId" AS student_id, id AS attendee_id, date, "attendanceStatus", "chargeAmount", net_events, net_money,
 CASE WHEN net_events<=0 THEN 'missing_charge_event' ELSE 'charge_event_without_money' END AS review_reason
FROM evidence WHERE class_status='completed' AND NOT "isPractice" AND "classType" IN ('individual','group','theory')
 AND "attendanceStatus" IN ('present','late','unexcused_absence') AND "chargeAmount"=0
 AND NOT has_free_event AND NOT (COALESCE(expected_price,-1)=0 AND net_events>0)
 ORDER BY date DESC,id;

\echo '=== 8. Legacy assignments without evidence for each required component; readiness is a separate report'
WITH components AS (
 SELECT m.*, s.status AS student_status, k.kind,
 CASE k.kind WHEN 'individual' THEN m."individualLessonPrice" WHEN 'theory' THEN m."theoryLessonPrice" ELSE m."groupLessonPrice" END AS saved_price
 FROM "Membership" m JOIN "Student" s ON s.id=m."studentId"
 CROSS JOIN LATERAL unnest(CASE WHEN m."lessonFormat" IN ('mixed','program') THEN ARRAY['individual','group','theory']
   WHEN m."lessonFormat"='individual' THEN ARRAY['individual'] WHEN m.type='theory' THEN ARRAY['theory'] ELSE ARRAY['group'] END) k(kind)
 WHERE m.status IN ('active','frozen') AND m.type<>'trial' AND COALESCE(to_jsonb(m)->>'billingModel','legacy')<>'rate_card'
)
SELECT id AS membership_id, "studentId" AS student_id, student_status, status, type, "lessonFormat", kind,
 'review_component_price_evidence' AS review_reason
FROM components WHERE (saved_price IS NULL OR saved_price < 0)
 AND NOT ("lessonFormat" NOT IN ('mixed','program') AND ("lessonPrice">0 OR ("totalClasses">0 AND ("totalPrice">0 OR ("totalPrice"=0 AND "basePrice">0)))))
ORDER BY "studentId",id,kind;

COMMIT;

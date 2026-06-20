// =====================================================
// Аналитика: обзор, преподаватели, менеджеры, админы.
// Доступ: admin и super_admin.
// =====================================================
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { Prisma } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getLostThresholdDate, LOST_STUDENT_MONTHS } = require('../utils/students');
const {
    computeAvgCheck,
    computeLtv,
    computeAvgLtv,
    computeAvgLifespanMonths,
    computeTrialConversion,
    MS_PER_DAY,
} = require('../utils/metrics');
const { timeToMinutes } = require('../utils/timeOverlap');
const { ensureTeacherScheduleColors } = require('../services/scheduleAppearance');

// ----- helpers -----

function parsePeriod(req) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const from = req.query.from ? new Date(req.query.from) : defaultFrom;
    const to   = req.query.to   ? new Date(req.query.to)   : now;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return { from: defaultFrom, to: now };
    }
    from.setHours(0, 0, 0, 0);
    // inclusive конец периода
    const toInc = new Date(to);
    toInc.setHours(23, 59, 59, 999);
    return { from, to: toInc };
}

function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
}

function groupByStudent(items, keyField = 'studentId') {
    const map = {};
    for (const it of items) {
        const k = it[keyField];
        if (!k) continue;
        if (!map[k]) map[k] = [];
        map[k].push(it);
    }
    return map;
}

// ============================================================
// GET /api/analytics/overview
// ============================================================
router.get('/overview', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const now = new Date();

        // --- Действующие ученики ---
        // Есть активный non-trial абонемент, действующий сейчас
        const nonTrialActiveRows = await prisma.membership.findMany({
            where: {
                status: 'active',
                endDate: { gte: now },
                type: { not: 'trial' },
                student: { role: 'student', status: 'active' },
            },
            select: { studentId: true },
            distinct: ['studentId'],
        });
        const activeStudentIds = new Set(nonTrialActiveRows.map(r => r.studentId));

        const trialActiveRows = await prisma.membership.findMany({
            where: {
                status: 'active',
                endDate: { gte: now },
                type: 'trial',
                student: { role: 'student', status: 'active' },
            },
            select: { studentId: true },
            distinct: ['studentId'],
        });
        const trialStudentIds = new Set(trialActiveRows.map(r => r.studentId));

        const activeStudents = activeStudentIds.size;
        const trialStudents  = trialStudentIds.size;
        const regularStudents = activeStudents; // non-trial активные — "постоянные"

        // --- Пробные за период: ученики, у кого в периоде появился membership type=trial ---
        const trialMembershipsInPeriod = await prisma.membership.findMany({
            where: {
                type: 'trial',
                createdAt: { gte: from, lte: to },
            },
            select: { studentId: true, createdAt: true, startDate: true, endDate: true },
        });
        const trialStudentIdsInPeriod = Array.from(new Set(trialMembershipsInPeriod.map(m => m.studentId)));
        const newTrialsInPeriod = trialStudentIdsInPeriod.length;

        // --- Конверсия пробный -> non-trial ---
        // Собираем студентов из периода у которых появился non-trial membership (любой)
        const nonTrialMems = trialStudentIdsInPeriod.length
            ? await prisma.membership.findMany({
                where: {
                    studentId: { in: trialStudentIdsInPeriod },
                    type: { not: 'trial' },
                },
                select: { studentId: true, createdAt: true, type: true, source: true },
              })
            : [];
        const convertedStudentIds = new Set(nonTrialMems.map(m => m.studentId));
        const trialToMembershipConversion = computeTrialConversion(
            trialStudentIdsInPeriod,
            Array.from(convertedStudentIds)
        );

        // --- Средний чек (non-trial membership покупки за период) ---
        const paymentsInPeriod = await prisma.payment.findMany({
            where: {
                status: 'completed',
                type: { in: ['membership_full', 'membership_advance', 'membership_balance'] },
                paymentDate: { gte: from, lte: to },
                amount: { gt: 0 },
            },
            select: { amount: true, status: true, studentId: true, paymentDate: true },
        });
        const avgCheck = computeAvgCheck(paymentsInPeriod);

        // --- Средняя продолжительность ---
        // Берём когорту "ушедших за период": последний non-trial membership закончился в [from, to]
        // и у студента нет активного membership на "сейчас".
        const allMems = await prisma.membership.findMany({
            where: { type: { not: 'trial' } },
            select: { studentId: true, startDate: true, endDate: true, status: true },
        });
        const memsByStudent = groupByStudent(allMems);
        const churnedInPeriod = {};
        for (const [sid, list] of Object.entries(memsByStudent)) {
            if (!list || list.length === 0) continue;
            let maxEnd = -Infinity;
            let hasActive = false;
            for (const m of list) {
                const e = m.endDate ? new Date(m.endDate).getTime() : -Infinity;
                if (e > maxEnd) maxEnd = e;
                if (m.status === 'active' && e >= now.getTime()) hasActive = true;
            }
            if (hasActive) continue;
            if (!Number.isFinite(maxEnd)) continue;
            if (maxEnd < from.getTime() || maxEnd > to.getTime()) continue;
            churnedInPeriod[sid] = list;
        }
        const avgLifespanMonths = computeAvgLifespanMonths(churnedInPeriod);
        const avgLifespanCohort = Object.keys(churnedInPeriod).length;

        // --- Churn after trial ---
        // Из trial-студентов периода: не купили non-trial за 30 дней от конца trial
        let churnAfterTrialCount = 0;
        for (const tm of trialMembershipsInPeriod) {
            const cutoff = new Date(tm.endDate || tm.createdAt);
            cutoff.setDate(cutoff.getDate() + 30);
            const converted = nonTrialMems.some(nm =>
                nm.studentId === tm.studentId &&
                new Date(nm.createdAt) <= cutoff
            );
            if (!converted) churnAfterTrialCount++;
        }
        const churnAfterTrial = {
            count: churnAfterTrialCount,
            total: trialMembershipsInPeriod.length,
            percent: percent(churnAfterTrialCount, trialMembershipsInPeriod.length),
        };

        // --- Churn after month 1 / month 2 ---
        // Берём non-trial memberships у которых endDate в периоде; не продлили = нет mem с createdAt <= endDate+45д
        const firstTierMems = await prisma.membership.findMany({
            where: {
                type: { not: 'trial' },
                endDate: { gte: from, lte: to },
            },
            select: { id: true, studentId: true, startDate: true, endDate: true, createdAt: true },
            orderBy: { startDate: 'asc' },
        });
        const allStudentMems = {};
        for (const m of allMems) {
            if (!allStudentMems[m.studentId]) allStudentMems[m.studentId] = [];
            allStudentMems[m.studentId].push(m);
        }
        for (const list of Object.values(allStudentMems)) {
            list.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        }

        let month1Total = 0, month1Churn = 0;
        let month2Total = 0, month2Churn = 0;
        for (const m of firstTierMems) {
            const list = allStudentMems[m.studentId] || [];
            const idx = list.findIndex(x => {
                const xs = new Date(x.startDate).getTime();
                const ms = new Date(m.startDate).getTime();
                return xs === ms;
            });
            if (idx === -1) continue;
            const nthMonth = idx + 1;
            if (nthMonth !== 1 && nthMonth !== 2) continue;
            const endOfThis = new Date(m.endDate || m.startDate).getTime();
            const cutoff = endOfThis + 45 * MS_PER_DAY;
            const renewed = list.slice(idx + 1).some(x => {
                const xc = new Date(x.createdAt).getTime();
                return xc <= cutoff;
            });
            if (nthMonth === 1) {
                month1Total++;
                if (!renewed) month1Churn++;
            } else {
                month2Total++;
                if (!renewed) month2Churn++;
            }
        }
        const churnAfterMonth1 = { count: month1Churn, total: month1Total, percent: percent(month1Churn, month1Total) };
        const churnAfterMonth2 = { count: month2Churn, total: month2Total, percent: percent(month2Churn, month2Total) };

        // --- Lost students (потерянные) ---
        // Источник истины — последний платёж ученика. Ученик "потерян",
        // если последний платёж был ≥ 3 мес. назад, либо платежей не было
        // и зарегистрирован > 3 мес. назад.
        const lostThreshold = getLostThresholdDate();
        const lostRows = await prisma.$queryRaw`
            SELECT COUNT(*)::int AS cnt
            FROM "Student" s
            WHERE s.role = 'student' AND s.status = 'active'
            AND COALESCE(
                (SELECT MAX(p."paymentDate") FROM "Payment" p
                 WHERE p."studentId" = s.id AND p."paymentDate" IS NOT NULL),
                s."createdAt"
            ) < ${lostThreshold}
        `;
        const lostStudents = Number((lostRows && lostRows[0] && lostRows[0].cnt) || 0);

        return res.json({
            success: true,
            period: { from, to },
            lostThresholdMonths: LOST_STUDENT_MONTHS,
            totals: {
                activeStudents,
                trialStudents,
                regularStudents,
                lostStudents,
            },
            period_metrics: {
                newTrialsInPeriod,
                trialToMembershipConversion,
                avgCheck,
                avgLifespanMonths,
                avgLifespanCohort,
                churnAfterTrial,
                churnAfterMonth1,
                churnAfterMonth2,
            },
        });
    } catch (error) {
        console.error('Analytics overview error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики' });
    }
});

// ============================================================
// GET /api/analytics/teachers
// ============================================================
router.get('/teachers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);
        const now = new Date();

        const teachers = await prisma.student.findMany({
            where: { role: 'teacher', status: 'active' },
            select: { id: true, name: true, lastName: true, phone: true },
        });

        // Все группы с teacherId -> studentId через StudentGroup (active)
        const groups = await prisma.group.findMany({
            where: { teacherId: { not: null } },
            select: {
                id: true,
                teacherId: true,
                students: { select: { studentId: true, status: true } },
            },
        });

        const teacherActiveStudentIds = {};
        const teacherAllStudentIds = {};
        for (const g of groups) {
            if (!teacherActiveStudentIds[g.teacherId]) teacherActiveStudentIds[g.teacherId] = new Set();
            if (!teacherAllStudentIds[g.teacherId]) teacherAllStudentIds[g.teacherId] = new Set();
            for (const sg of g.students) {
                teacherAllStudentIds[g.teacherId].add(sg.studentId);
                if (sg.status === 'active') teacherActiveStudentIds[g.teacherId].add(sg.studentId);
            }
        }

        // Платежи по teacherId (прямое поле)
        const teacherPayments = await prisma.payment.findMany({
            where: {
                status: 'completed',
                teacherId: { in: teachers.map(t => t.id) },
                paymentDate: { gte: from, lte: to },
                amount: { gt: 0 },
            },
            select: { amount: true, teacherId: true, studentId: true, status: true },
        });

        const lostThreshold = getLostThresholdDate();
        const nowMs = new Date().getTime();

        const result = [];
        for (const t of teachers) {
            const activeStudentSet = teacherActiveStudentIds[t.id] || new Set();
            const activeStudentIds = Array.from(activeStudentSet);

            const allStudentSet = teacherAllStudentIds[t.id] || new Set();
            const allStudentIds = Array.from(allStudentSet);

            // Средний чек по платежам где teacherId = t.id (в периоде)
            const payments = teacherPayments.filter(p => p.teacherId === t.id);
            const avgCheckTeacher = computeAvgCheck(payments);

            // LTV за период: сумма completed-платежей этих учеников в [from, to] / число активных учеников
            const ltvPayments = activeStudentIds.length ? await prisma.payment.findMany({
                where: {
                    studentId: { in: activeStudentIds },
                    status: 'completed',
                    amount: { gt: 0 },
                    paymentDate: { gte: from, lte: to },
                },
                select: { amount: true, studentId: true, status: true },
            }) : [];
            const paymentsByStudent = {};
            for (const sid of activeStudentIds) paymentsByStudent[sid] = [];
            for (const p of ltvPayments) {
                if (!paymentsByStudent[p.studentId]) paymentsByStudent[p.studentId] = [];
                paymentsByStudent[p.studentId].push(p);
            }
            const avgLtv = computeAvgLtv(paymentsByStudent);

            // Средняя продолжительность: когорта учеников, ушедших (последний mem закончился) в [from, to].
            const nonTrialMemsAll = allStudentIds.length ? await prisma.membership.findMany({
                where: { studentId: { in: allStudentIds }, type: { not: 'trial' } },
                select: { studentId: true, startDate: true, endDate: true, status: true },
            }) : [];
            
            const memsByStudent = {};
            for (const m of nonTrialMemsAll) {
                if (!memsByStudent[m.studentId]) memsByStudent[m.studentId] = [];
                memsByStudent[m.studentId].push(m);
            }
            const churnedInPeriod = {};
            for (const [sid, list] of Object.entries(memsByStudent)) {
                let maxEnd = -Infinity;
                let hasActive = false;
                for (const m of list) {
                    const e = m.endDate ? new Date(m.endDate).getTime() : -Infinity;
                    if (e > maxEnd) maxEnd = e;
                    if (m.status === 'active' && e >= nowMs) hasActive = true;
                }
                if (hasActive) continue;
                if (!Number.isFinite(maxEnd)) continue;
                if (maxEnd < from.getTime() || maxEnd > to.getTime()) continue;
                churnedInPeriod[sid] = list;
            }
            const avgLifespanMonths = computeAvgLifespanMonths(churnedInPeriod);
            const avgLifespanCohort = Object.keys(churnedInPeriod).length;

            // Потерянные среди их студентов (по последнему платежу)
            let lostCount = 0;
            if (allStudentIds.length) {
                const rows = await prisma.$queryRaw`
                    SELECT COUNT(*)::int AS cnt
                    FROM "Student" s
                    WHERE s.id IN (${Prisma.join(allStudentIds)})
                    AND COALESCE(
                        (SELECT MAX(p."paymentDate") FROM "Payment" p
                         WHERE p."studentId" = s.id AND p."paymentDate" IS NOT NULL),
                        s."createdAt"
                    ) < ${lostThreshold}
                `;
                lostCount = Number((rows && rows[0] && rows[0].cnt) || 0);
            }

            result.push({
                id: t.id,
                name: [t.lastName, t.name].filter(Boolean).join(' ').trim() || '—',
                studentsCount: activeStudentIds.length,
                lostCount,
                avgCheck: avgCheckTeacher,
                avgLtv,
                avgLifespanMonths,
                avgLifespanCohort,
            });
        }

        // Сортируем по количеству учеников убыв.
        result.sort((a, b) => b.studentsCount - a.studentsCount);

        return res.json({ success: true, period: { from, to }, teachers: result });
    } catch (error) {
        console.error('Analytics teachers error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики по преподавателям' });
    }
});

// ----- precompute per-user churn (month1/month2) -----
// Возвращает Map<userId, { m1: {total, churn}, m2: {total, churn} }>
// по всем non-trial абонементам, у которых endDate в периоде [from, to].
// Атрибуция идёт по createdById 1-го или 2-го non-trial абонемента у ученика.
async function computePerUserChurn({ from, to }) {
    const allNonTrialMems = await prisma.membership.findMany({
        where: { type: { not: 'trial' } },
        select: { id: true, studentId: true, startDate: true, endDate: true, createdAt: true, createdById: true },
        orderBy: { startDate: 'asc' },
    });
    const byStudent = {};
    for (const m of allNonTrialMems) {
        if (!byStudent[m.studentId]) byStudent[m.studentId] = [];
        byStudent[m.studentId].push(m);
    }

    const perUser = new Map();
    const bump = (userId, key, churned) => {
        if (!userId) return;
        if (!perUser.has(userId)) perUser.set(userId, { m1: { total: 0, churn: 0 }, m2: { total: 0, churn: 0 } });
        const u = perUser.get(userId);
        u[key].total += 1;
        if (churned) u[key].churn += 1;
    };

    for (const list of Object.values(byStudent)) {
        list.forEach((m, idx) => {
            const nth = idx + 1;
            if (nth !== 1 && nth !== 2) return;
            const end = m.endDate ? new Date(m.endDate).getTime() : null;
            if (end == null) return;
            if (end < from.getTime() || end > to.getTime()) return;
            const cutoff = end + 45 * MS_PER_DAY;
            const renewed = list.slice(idx + 1).some(x => new Date(x.createdAt).getTime() <= cutoff);
            const key = nth === 1 ? 'm1' : 'm2';
            bump(m.createdById, key, !renewed);
        });
    }
    return perUser;
}

// ============================================================
// GET /api/analytics/managers
// ============================================================
router.get('/managers', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        const managers = await prisma.student.findMany({
            where: { role: 'sales_manager', status: 'active' },
            select: { id: true, name: true, lastName: true, phone: true },
        });

        const perUserChurn = await computePerUserChurn({ from, to });

        const result = [];
        for (const m of managers) {
            // Заявок обработано за период
            const bookingsProcessed = await prisma.booking.count({
                where: {
                    processedById: m.id,
                    processedAt: { gte: from, lte: to },
                },
            });

            // Пробных продано: их заявки со статусом trial/sold
            const trialsSold = await prisma.booking.count({
                where: {
                    processedById: m.id,
                    processedAt: { gte: from, lte: to },
                    status: { in: ['trial', 'sold'] },
                },
            });

            // Абонементы проданы (не пробные)
            const membershipsSold = await prisma.membership.count({
                where: {
                    createdById: m.id,
                    type: { not: 'trial' },
                    createdAt: { gte: from, lte: to },
                },
            });

            // Студенты с пробниками от этого менеджера
            const theirBookings = await prisma.booking.findMany({
                where: {
                    processedById: m.id,
                    processedAt: { gte: from, lte: to },
                    status: { in: ['trial', 'sold'] },
                    convertedToStudentId: { not: null },
                },
                select: { convertedToStudentId: true, groupId: true },
            });
            const theirStudentIds = theirBookings.map(b => b.convertedToStudentId).filter(Boolean);

            // Доходимость: % учеников, которые реально посетили >=1 занятие
            let trialRetention = { count: 0, total: theirStudentIds.length, percent: 0 };
            if (theirStudentIds.length) {
                const attendedRows = await prisma.classAttendee.findMany({
                    where: {
                        studentId: { in: theirStudentIds },
                        attended: true,
                    },
                    select: { studentId: true },
                    distinct: ['studentId'],
                });
                trialRetention.count = attendedRows.length;
                trialRetention.percent = percent(attendedRows.length, theirStudentIds.length);
            }

            // Конверсия: их trial-ученики -> non-trial membership
            let postTrialConversion = { converted: 0, total: theirStudentIds.length, percent: 0 };
            if (theirStudentIds.length) {
                const nonTrial = await prisma.membership.findMany({
                    where: {
                        studentId: { in: theirStudentIds },
                        type: { not: 'trial' },
                    },
                    select: { studentId: true },
                    distinct: ['studentId'],
                });
                postTrialConversion.converted = nonTrial.length;
                postTrialConversion.percent = percent(nonTrial.length, theirStudentIds.length);
            }

            // Phase 2: возражения (loss reasons) по его заявкам, потерянным в периоде
            const lostBookings = await prisma.booking.findMany({
                where: {
                    processedById: m.id,
                    OR: [
                        { status: 'rejected', updatedAt: { gte: from, lte: to } },
                        { lostAt: { gte: from, lte: to } },
                    ],
                },
                select: { lossReason: true, lossStage: true },
            });
            const lossReasonBreakdown = {};
            const lossStageBreakdown = {};
            for (const b of lostBookings) {
                if (b.lossReason) lossReasonBreakdown[b.lossReason] = (lossReasonBreakdown[b.lossReason] || 0) + 1;
                if (b.lossStage) lossStageBreakdown[b.lossStage] = (lossStageBreakdown[b.lossStage] || 0) + 1;
            }
            const lostCountTotal = lostBookings.length;

            // Phase 2: кто сколько потеряшек вернул в периоде
            const recoveredCount = await prisma.studentRecovery.count({
                where: {
                    recoveredByUserId: m.id,
                    recoveredAt: { gte: from, lte: to },
                },
            });

            const userChurn = perUserChurn.get(m.id) || { m1: { total: 0, churn: 0 }, m2: { total: 0, churn: 0 } };
            const churnMonth1 = {
                total: userChurn.m1.total,
                churned: userChurn.m1.churn,
                percent: percent(userChurn.m1.churn, userChurn.m1.total),
            };
            const churnMonth2 = {
                total: userChurn.m2.total,
                churned: userChurn.m2.churn,
                percent: percent(userChurn.m2.churn, userChurn.m2.total),
            };

            result.push({
                id: m.id,
                name: [m.lastName, m.name].filter(Boolean).join(' ').trim() || '—',
                bookingsProcessed,
                trialsSold,
                membershipsSold,
                trialRetention,
                postTrialConversion,
                lostCount: lostCountTotal,
                lossReasons: lossReasonBreakdown,
                lossStages: lossStageBreakdown,
                recoveredCount,
                churnMonth1,
                churnMonth2,
            });
        }

        result.sort((a, b) => b.bookingsProcessed - a.bookingsProcessed);

        return res.json({ success: true, period: { from, to }, managers: result });
    } catch (error) {
        console.error('Analytics managers error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики по менеджерам' });
    }
});

// ============================================================
// GET /api/analytics/admins
// ============================================================
router.get('/admins', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        const admins = await prisma.student.findMany({
            where: { role: { in: ['admin', 'super_admin'] }, status: 'active' },
            select: { id: true, name: true, lastName: true, phone: true, role: true },
        });

        const perUserChurn = await computePerUserChurn({ from, to });

        const result = [];
        for (const a of admins) {
            const trialsHandled = await prisma.booking.count({
                where: {
                    processedById: a.id,
                    processedAt: { gte: from, lte: to },
                    status: { in: ['trial', 'sold'] },
                },
            });

            // Все их созданные абонементы в периоде
            const theirMems = await prisma.membership.findMany({
                where: {
                    createdById: a.id,
                    createdAt: { gte: from, lte: to },
                    type: { not: 'trial' },
                },
                select: { id: true, studentId: true, source: true, startDate: true },
            });
            const membershipsSold = theirMems.length;
            const renewals = theirMems.filter(m => m.source === 'renewal').length;

            // churn new vs existing clients:
            // new — у ученика ДО этого абонемента не было non-trial memberships (первый абонемент через этого админа)
            // existing — были раньше
            let newClientsCount = 0, existingClientsCount = 0;
            let newChurn = 0, existingChurn = 0;
            const now = new Date();
            for (const m of theirMems) {
                const priorMems = await prisma.membership.count({
                    where: {
                        studentId: m.studentId,
                        type: { not: 'trial' },
                        startDate: { lt: m.startDate },
                    },
                });
                const isNewClient = priorMems === 0;
                if (isNewClient) newClientsCount++; else existingClientsCount++;

                // "Отток" по этому клиенту: нет следующего non-trial mem и endDate < now - 14 дней
                const nextMems = await prisma.membership.count({
                    where: {
                        studentId: m.studentId,
                        type: { not: 'trial' },
                        startDate: { gt: m.startDate },
                    },
                });
                if (nextMems === 0) {
                    const ms = await prisma.membership.findUnique({
                        where: { id: m.id },
                        select: { endDate: true },
                    });
                    const e = ms?.endDate ? new Date(ms.endDate) : null;
                    if (e && (now.getTime() - e.getTime() > 14 * MS_PER_DAY)) {
                        if (isNewClient) newChurn++; else existingChurn++;
                    }
                }
            }

            // Phase 2: возражения/потери по его заявкам
            const lostBookings = await prisma.booking.findMany({
                where: {
                    processedById: a.id,
                    OR: [
                        { status: 'rejected', updatedAt: { gte: from, lte: to } },
                        { lostAt: { gte: from, lte: to } },
                    ],
                },
                select: { lossReason: true, lossStage: true },
            });
            const lossReasonBreakdown = {};
            const lossStageBreakdown = {};
            for (const b of lostBookings) {
                if (b.lossReason) lossReasonBreakdown[b.lossReason] = (lossReasonBreakdown[b.lossReason] || 0) + 1;
                if (b.lossStage) lossStageBreakdown[b.lossStage] = (lossStageBreakdown[b.lossStage] || 0) + 1;
            }

            const recoveredCount = await prisma.studentRecovery.count({
                where: {
                    recoveredByUserId: a.id,
                    recoveredAt: { gte: from, lte: to },
                },
            });

            const userChurn = perUserChurn.get(a.id) || { m1: { total: 0, churn: 0 }, m2: { total: 0, churn: 0 } };
            const churnMonth1 = {
                total: userChurn.m1.total,
                churned: userChurn.m1.churn,
                percent: percent(userChurn.m1.churn, userChurn.m1.total),
            };
            const churnMonth2 = {
                total: userChurn.m2.total,
                churned: userChurn.m2.churn,
                percent: percent(userChurn.m2.churn, userChurn.m2.total),
            };

            result.push({
                id: a.id,
                role: a.role,
                name: [a.lastName, a.name].filter(Boolean).join(' ').trim() || '—',
                trialsHandled,
                membershipsSold,
                renewals,
                churnNewClients: { count: newChurn, total: newClientsCount, percent: percent(newChurn, newClientsCount) },
                churnExistingClients: { count: existingChurn, total: existingClientsCount, percent: percent(existingChurn, existingClientsCount) },
                lostCount: lostBookings.length,
                lossReasons: lossReasonBreakdown,
                lossStages: lossStageBreakdown,
                recoveredCount,
                churnMonth1,
                churnMonth2,
            });
        }

        result.sort((a, b) => b.membershipsSold - a.membershipsSold);

        return res.json({ success: true, period: { from, to }, admins: result });
    } catch (error) {
        console.error('Analytics admins error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики по админам' });
    }
});

// ============================================================
// GET /api/analytics/losses
// Сводка возражений/потерь за период: топ причин, распределение по этапам,
// последние возвраты.
// ============================================================
router.get('/losses', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        const lostBookings = await prisma.booking.findMany({
            where: {
                OR: [
                    { status: 'rejected', updatedAt: { gte: from, lte: to } },
                    { lostAt: { gte: from, lte: to } },
                ],
            },
            select: {
                id: true,
                lossReason: true,
                lossStage: true,
                lostAt: true,
                processedBy: { select: { id: true, name: true, lastName: true } },
            },
        });

        const byReason = {};
        const byStage = {};
        for (const b of lostBookings) {
            const reason = b.lossReason || '—';
            const stage = b.lossStage || '—';
            byReason[reason] = (byReason[reason] || 0) + 1;
            byStage[stage] = (byStage[stage] || 0) + 1;
        }

        const recoveries = await prisma.studentRecovery.findMany({
            where: { recoveredAt: { gte: from, lte: to } },
            orderBy: { recoveredAt: 'desc' },
            take: 100,
            include: {
                student: { select: { id: true, name: true, lastName: true, phone: true } },
                recoveredByUser: { select: { id: true, name: true, lastName: true, role: true } },
            },
        });

        const recoveriesByUser = {};
        for (const r of recoveries) {
            const uid = r.recoveredByUserId;
            if (!recoveriesByUser[uid]) {
                recoveriesByUser[uid] = {
                    userId: uid,
                    name: [r.recoveredByUser?.lastName, r.recoveredByUser?.name].filter(Boolean).join(' ').trim() || '—',
                    role: r.recoveredByUser?.role || null,
                    count: 0,
                };
            }
            recoveriesByUser[uid].count += 1;
        }

        return res.json({
            success: true,
            period: { from, to },
            totals: {
                lostCount: lostBookings.length,
                recoveredCount: recoveries.length,
            },
            byReason,
            byStage,
            recoveriesByUser: Object.values(recoveriesByUser).sort((a, b) => b.count - a.count),
            recentRecoveries: recoveries.slice(0, 30).map(r => ({
                id: r.id,
                studentId: r.studentId,
                studentName: [r.student?.lastName, r.student?.name].filter(Boolean).join(' ').trim() || '—',
                phone: r.student?.phone || null,
                note: r.note || null,
                recoveredAt: r.recoveredAt,
                recoveredByName: [r.recoveredByUser?.lastName, r.recoveredByUser?.name].filter(Boolean).join(' ').trim() || '—',
            })),
        });
    } catch (error) {
        console.error('Analytics losses error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики потерь' });
    }
});

// ============================================================
// GET /api/analytics/teacher-revenue
// Сколько денег принёс каждый тренер за период.
// Логика:
// 1. Берём занятия (Class) в периоде [from, to], где teacherId != null.
// 2. Для каждого занятия берём attendees с attended: true.
// 3. Для каждого ученика находим активный абонемент (Membership).
// 4. Стоимость одного занятия = membership.totalPrice / membership.totalClasses.
// 5. Сумма = perClassCost * кол-во занятий ученика с этим тренером в периоде.
// 6. Суммируем по всем ученикам для каждого тренера.
// ============================================================
router.get('/teacher-revenue', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to } = parsePeriod(req);

        // 1. Все занятия за период где есть тренер
        const classes = await prisma.class.findMany({
            where: {
                date: { gte: from, lte: to },
                teacherId: { not: null },
                status: { not: 'cancelled' },
            },
            select: {
                id: true,
                teacherId: true,
                date: true,
                title: true,
                groupId: true,
                attendees: {
                    where: { attended: true },
                    select: { studentId: true },
                },
            },
        });

        // 2. Собираем уникальных студентов по всем занятиям
        const allStudentIds = new Set();
        for (const cls of classes) {
            for (const att of cls.attendees) {
                if (att.studentId) allStudentIds.add(att.studentId);
            }
        }

        // 3. Загружаем все активные и завершённые абонементы этих учеников
        //    (ищем абонемент, актуальный на момент занятия — берём последний по дате начала до занятия)
        const studentIds = Array.from(allStudentIds);
        const allMemberships = studentIds.length > 0 ? await prisma.membership.findMany({
            where: {
                studentId: { in: studentIds },
                type: { not: 'trial' },
                totalClasses: { gt: 0 },
                totalPrice: { gt: 0 },
            },
            select: {
                id: true,
                studentId: true,
                groupId: true,
                totalPrice: true,
                totalClasses: true,
                startDate: true,
                endDate: true,
                status: true,
            },
            orderBy: { startDate: 'desc' },
        }) : [];

        // Индекс: studentId -> список мемберов (отсортированы по startDate desc)
        const memsByStudent = {};
        for (const m of allMemberships) {
            if (!memsByStudent[m.studentId]) memsByStudent[m.studentId] = [];
            memsByStudent[m.studentId].push(m);
        }

        // Подбор абонемента для ученика на дату занятия
        // Приоритет: 1) group-specific абонемент 2) общий (groupId: null)
        function findMembership(studentId, classDate, groupId) {
            const list = memsByStudent[studentId] || [];
            // 1. Абонемент на конкретную группу, покрывающий дату
            if (groupId) {
                const groupMem = list.find(m =>
                    m.groupId === groupId &&
                    new Date(m.startDate) <= classDate &&
                    new Date(m.endDate) >= classDate
                );
                if (groupMem) return groupMem;
            }
            // 2. Общий абонемент (без группы), покрывающий дату
            const generalMem = list.find(m =>
                !m.groupId &&
                new Date(m.startDate) <= classDate &&
                new Date(m.endDate) >= classDate
            );
            if (generalMem) return generalMem;
            // 3. Фоллбэк: любой абонемент покрывающий дату
            const anyMem = list.find(m =>
                new Date(m.startDate) <= classDate &&
                new Date(m.endDate) >= classDate
            );
            return anyMem || null;
        }

        // 4. Считаем выручку по тренерам
        // Структура: teacherId -> { total, students: { studentId -> { name, classes, revenue } } }
        const teacherRevenue = {};

        for (const cls of classes) {
            const tid = cls.teacherId;
            if (!teacherRevenue[tid]) {
                teacherRevenue[tid] = { totalRevenue: 0, totalClasses: 0, studentDetails: {} };
            }
            teacherRevenue[tid].totalClasses++;

            for (const att of cls.attendees) {
                const sid = att.studentId;
                if (!sid) continue;

                const membership = findMembership(sid, new Date(cls.date), cls.groupId);
                if (!membership) continue;

                const perClassCost = Math.round(membership.totalPrice / membership.totalClasses);

                teacherRevenue[tid].totalRevenue += perClassCost;

                if (!teacherRevenue[tid].studentDetails[sid]) {
                    teacherRevenue[tid].studentDetails[sid] = { classCount: 0, revenue: 0, membershipId: membership.id };
                }
                teacherRevenue[tid].studentDetails[sid].classCount++;
                teacherRevenue[tid].studentDetails[sid].revenue += perClassCost;
            }
        }

        // 5. Загружаем имена тренеров
        const teacherIds = Object.keys(teacherRevenue);
        const teachers = teacherIds.length > 0 ? await prisma.student.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true, lastName: true },
        }) : [];
        const teacherMap = {};
        for (const t of teachers) {
            teacherMap[t.id] = [t.lastName, t.name].filter(Boolean).join(' ').trim() || '—';
        }

        // 6. Загружаем имена учеников для деталей
        const allDetailStudentIds = new Set();
        for (const data of Object.values(teacherRevenue)) {
            for (const sid of Object.keys(data.studentDetails)) {
                allDetailStudentIds.add(sid);
            }
        }
        const detailStudents = allDetailStudentIds.size > 0 ? await prisma.student.findMany({
            where: { id: { in: Array.from(allDetailStudentIds) } },
            select: { id: true, name: true, lastName: true },
        }) : [];
        const studentMap = {};
        for (const s of detailStudents) {
            studentMap[s.id] = [s.lastName, s.name].filter(Boolean).join(' ').trim() || '—';
        }

        // 7. Формируем ответ
        const result = teacherIds.map(tid => {
            const data = teacherRevenue[tid];
            const students = Object.entries(data.studentDetails)
                .map(([sid, info]) => ({
                    id: sid,
                    name: studentMap[sid] || '—',
                    classCount: info.classCount,
                    revenue: info.revenue,
                }))
                .sort((a, b) => b.revenue - a.revenue);

            return {
                id: tid,
                name: teacherMap[tid] || '—',
                totalRevenue: data.totalRevenue,
                totalClasses: data.totalClasses,
                studentsCount: students.length,
                students,
            };
        }).sort((a, b) => b.totalRevenue - a.totalRevenue);

        const grandTotal = result.reduce((sum, t) => sum + t.totalRevenue, 0);

        return res.json({
            success: true,
            period: { from, to },
            grandTotal,
            teachers: result,
        });
    } catch (error) {
        console.error('Analytics teacher-revenue error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка сбора аналитики доходов по тренерам' });
    }
});

// ============================================================
// GET /api/analytics/utilization
// Загруженность преподавателей и кабинетов по расписанию.
// ============================================================
router.get('/utilization', authenticate, requireAdmin, async (req, res) => {
    try {
        await ensureTeacherScheduleColors();
        const { from, to } = parsePeriod(req);
        const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY));
        const periodWeeks = periodDays / 7;

        const [teachers, rooms, classes] = await Promise.all([
            prisma.student.findMany({
                where: { role: 'teacher', status: 'active' },
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    teacherScheduleColor: true,
                    teacherWeeklyHours: true,
                },
                orderBy: [{ name: 'asc' }, { lastName: 'asc' }],
            }),
            prisma.room.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    name: true,
                    workingStart: true,
                    workingEnd: true,
                },
                orderBy: { name: 'asc' },
            }),
            prisma.class.findMany({
                where: { date: { gte: from, lte: to } },
                select: {
                    teacherId: true,
                    roomId: true,
                    startTime: true,
                    endTime: true,
                    duration: true,
                    status: true,
                    isPractice: true,
                },
            }),
        ]);

        const classMinutes = (item) => {
            const fromTime = timeToMinutes(item.startTime);
            const toTime = timeToMinutes(item.endTime);
            const calculated = toTime > fromTime ? toTime - fromTime : 0;
            return calculated || Math.max(0, Number(item.duration) || 0);
        };

        const teacherUtilization = teachers.map((teacher) => {
            const rows = classes.filter((item) => item.teacherId === teacher.id);
            const scheduledMinutes = rows
                .filter((item) => item.status !== 'cancelled')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const completedMinutes = rows
                .filter((item) => item.status === 'completed')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const cancelledMinutes = rows
                .filter((item) => item.status === 'cancelled')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const weeklyNormHours = teacher.teacherWeeklyHours || 40;
            const periodNormMinutes = weeklyNormHours * periodWeeks * 60;

            return {
                id: teacher.id,
                name: `${teacher.name} ${teacher.lastName || ''}`.trim(),
                color: teacher.teacherScheduleColor || '#6B7280',
                weeklyNormHours,
                periodNormHours: Math.round((periodNormMinutes / 60) * 10) / 10,
                scheduledHours: Math.round((scheduledMinutes / 60) * 10) / 10,
                completedHours: Math.round((completedMinutes / 60) * 10) / 10,
                cancelledHours: Math.round((cancelledMinutes / 60) * 10) / 10,
                utilizationPercent: periodNormMinutes > 0
                    ? Math.round((scheduledMinutes / periodNormMinutes) * 100)
                    : 0,
            };
        }).sort((a, b) => b.utilizationPercent - a.utilizationPercent);

        const roomUtilization = rooms.map((room) => {
            const startMinutes = timeToMinutes(room.workingStart || '08:00');
            const endMinutes = timeToMinutes(room.workingEnd || '21:00');
            const availableMinutes = Math.max(0, endMinutes - startMinutes) * periodDays;
            const occupiedMinutes = classes
                .filter((item) => item.roomId === room.id && item.status !== 'cancelled')
                .reduce((sum, item) => sum + classMinutes(item), 0);
            const freeMinutes = Math.max(0, availableMinutes - occupiedMinutes);

            return {
                id: room.id,
                name: room.name,
                workingStart: room.workingStart || '08:00',
                workingEnd: room.workingEnd || '21:00',
                availableHours: Math.round((availableMinutes / 60) * 10) / 10,
                occupiedHours: Math.round((occupiedMinutes / 60) * 10) / 10,
                freeHours: Math.round((freeMinutes / 60) * 10) / 10,
                utilizationPercent: availableMinutes > 0
                    ? Math.min(100, Math.round((occupiedMinutes / availableMinutes) * 100))
                    : 0,
            };
        }).sort((a, b) => b.utilizationPercent - a.utilizationPercent);

        return res.json({
            success: true,
            period: { from, to, days: periodDays },
            teachers: teacherUtilization,
            rooms: roomUtilization,
        });
    } catch (error) {
        console.error('Analytics utilization error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка расчёта загрузки расписания' });
    }
});

module.exports = router;

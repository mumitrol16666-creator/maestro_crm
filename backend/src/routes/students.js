const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireSalesOrAdmin, requireTeacherOrAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// GET /api/students
router.get('/', authenticate, requireTeacherOrAdmin, async (req, res) => {
    try {
        const { search, page = 1, limit = 20, status } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const where = { role: 'student' };
        if (status) where.status = status;

        if (search && search.trim()) {
            const term = search.trim();
            const digits = term.replace(/\D/g, '');
            const words = term.split(/\s+/);
            const orConditions = [];
            if (words.length === 1) {
                orConditions.push({ name: { contains: term, mode: 'insensitive' } });
                orConditions.push({ lastName: { contains: term, mode: 'insensitive' } });
            } else {
                orConditions.push({ AND: [{ name: { contains: words[0], mode: 'insensitive' } }, { lastName: { contains: words[1], mode: 'insensitive' } }] });
            }
            if (digits.length >= 3) orConditions.push({ phoneDigits: { contains: digits } });
            where.OR = orConditions;
        }

        const [students, total] = await Promise.all([
            prisma.student.findMany({
                where,
                select: {
                    id: true, name: true, lastName: true, phone: true, email: true, gender: true,
                    dateOfBirth: true, status: true, notes: true, registeredAt: true, createdAt: true,
                    activeMembershipId: true,
                    groups: { include: { group: { select: { id: true, name: true, direction: true, schedules: true } } } },
                    memberships: { 
                        where: { status: 'active' },
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true, type: true, classesRemaining: true, totalClasses: true,
                            startDate: true, endDate: true, status: true, groupId: true,
                            remainingAmount: true, paymentStatus: true, paidAmount: true, totalPrice: true,
                            payments: {
                                where: { dueDate: { not: null } },
                                orderBy: { dueDate: 'asc' },
                                take: 1,
                                select: { dueDate: true }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip, take: limitNum
            }),
            prisma.student.count({ where })
        ]);

        const now = new Date();

        const mapped = students.map(s => {
            // Выбираем абонемент для отображения долга с тем же приоритетом, что в карточке:
            // сначала monthly/quarterly/individual_package, иначе — первый активный.
            // Это важно, чтобы список и профиль смотрели на ОДИН и тот же абонемент
            // (например, если у ученика есть активный trial + monthly со split-долгом).
            const activeMemberships = s.memberships || [];
            let bestMembership = activeMemberships.find(m =>
                m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package'
            );
            if (!bestMembership) bestMembership = activeMemberships[0] || null;

            let debtAmount = 0;
            let isOverdue = false;
            let overdueDays = 0;
            let promisedPaymentDate = null;

            if (bestMembership && bestMembership.remainingAmount > 0) {
                debtAmount = bestMembership.remainingAmount;

                // Обещанная дата оплаты = ближайший dueDate по платежам абонемента.
                // Попадают все сценарии: full, advance (split), later (оплата позже).
                const dueDatePayment = bestMembership.payments?.[0];

                if (dueDatePayment?.dueDate) {
                    promisedPaymentDate = dueDatePayment.dueDate;
                    const dueDate = new Date(dueDatePayment.dueDate);

                    // Устанавливаем начало дня для корректного сравнения
                    const dueDateStart = new Date(dueDate);
                    dueDateStart.setHours(0,0,0,0);
                    const nowStart = new Date(now);
                    nowStart.setHours(0,0,0,0);

                    if (nowStart > dueDateStart) {
                        isOverdue = true;
                        const diffTime = Math.abs(nowStart - dueDateStart);
                        overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 0;
                    }
                }
            }

            return {
                ...s, _id: s.id, password: undefined,
                groups: s.groups.map(sg => ({
                    ...sg,
                    groupId: sg.group ? { ...sg.group, _id: sg.group.id } : null,
                    group: sg.group ? { ...sg.group, _id: sg.group.id } : null
                })),
                activeMembership: bestMembership ? { ...bestMembership, _id: bestMembership.id, payments: undefined } : null,
                memberships: undefined,
                debtAmount,
                isOverdue,
                overdueDays,
                promisedPaymentDate
            };
        });

        res.json({ success: true, count: mapped.length, total, page: pageNum, pages: Math.ceil(total / limitNum), students: mapped });
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения учеников' });
    }
});

// POST /api/students/stats/batch-light (Массовое получение статистики)
router.post('/stats/batch-light', authenticate, async (req, res) => {
    try {
        const { studentIds } = req.body;
        if (!studentIds || !Array.isArray(studentIds)) {
            return res.status(400).json({ success: false, error: 'studentIds должен быть массивом' });
        }

        // Получаем пропуски за текущий месяц для всех указанных учеников
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const attendances = await prisma.classAttendee.findMany({
            where: {
                studentId: { in: studentIds },
                attended: false,
                class: { date: { gte: startOfMonth } }
            },
            select: { studentId: true }
        });

        // Группируем пропуски по студентам
        const statsMap = {};
        studentIds.forEach(id => {
            statsMap[id] = { monthMissed: 0 };
        });

        attendances.forEach(a => {
            if (statsMap[a.studentId]) {
                statsMap[a.studentId].monthMissed++;
            }
        });

        res.json({ success: true, stats: statsMap });
    } catch (error) {
        console.error('Batch stats error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения статистики' });
    }
});

// GET /api/students/:id/stats
router.get('/:id/stats', authenticate, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        const attendances = await prisma.classAttendee.findMany({
            where: { studentId },
            include: { class: true },
            orderBy: { class: { date: 'desc' } },
            take: 20
        });

        const totalClasses = attendances.length;
        const attendedCount = attendances.filter(a => a.attended).length;
        const missedCount = totalClasses - attendedCount;
        const attendanceRate = totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 0;

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const monthMissed = attendances.filter(a => 
            !a.attended && a.class && new Date(a.class.date) >= startOfMonth
        ).length;

        const lastAttended = attendances.find(a => a.attended);

        res.json({
            success: true,
            stats: {
                attendanceRate,
                totalClasses,
                attendedCount,
                missedCount,
                monthMissed,
                lastAttendedDate: lastAttended && lastAttended.class ? lastAttended.class.date : null,
                recentHistory: attendances.map(a => ({
                    date: a.class ? a.class.date : new Date(),
                    attended: a.attended,
                    title: a.class ? a.class.title : 'Занятие'
                }))
            }
        });
    } catch (error) {
        console.error('Get student stats error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения статистики' });
    }
});

// GET /api/students/:id
router.get('/:id', authenticate, async (req, res) => {
    try {
        const student = await prisma.student.findUnique({
            where: { id: req.params.id },
            include: {
                groups: { include: { group: { select: { id: true, name: true, direction: true, schedules: true } } } },
                activeMembership: true,
                memberships: { 
                    orderBy: { createdAt: 'desc' }, 
                    take: 10,
                    include: { payments: { where: { dueDate: { not: null } }, orderBy: { dueDate: 'asc' }, take: 1 } }
                },
                payments: { orderBy: { createdAt: 'desc' }, take: 20 }
            }
        });
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });

        // Маппим группы в Mongoose-совместимый формат
        // Берём лучший активный абонемент (та же логика, что в списке и на фронтенде)
        const activeMemberships = student.memberships.filter(m => m.status === 'active');
        let bestMembership = activeMemberships.find(m =>
            m.type === 'monthly' || m.type === 'monthly_12' || m.type === 'quarterly' || m.type === 'individual_package'
        );
        if (!bestMembership) bestMembership = activeMemberships[0] || null;

        // Долг равен фактическому остатку абонемента (включая split-оплаты,
        // где есть аванс и обещанная дата доплаты). Ранее здесь remainingAmount
        // обнулялся, если dueDate в будущем, что приводило к тому, что фронт
        // не показывал ни сумму долга, ни обещанную дату для split-оплат.
        let debtAmount = 0;
        let isOverdue = false;
        let overdueDays = 0;
        let promisedPaymentDate = null;

        if (bestMembership && bestMembership.remainingAmount > 0) {
            debtAmount = bestMembership.remainingAmount;

            const latestPayment = bestMembership.payments?.[0];
            if (latestPayment?.dueDate) {
                promisedPaymentDate = latestPayment.dueDate;

                const dueDateStart = new Date(latestPayment.dueDate);
                dueDateStart.setHours(0, 0, 0, 0);
                const nowStart = new Date();
                nowStart.setHours(0, 0, 0, 0);

                if (nowStart > dueDateStart) {
                    isOverdue = true;
                    overdueDays = Math.ceil(Math.abs(nowStart - dueDateStart) / (1000 * 60 * 60 * 24)) || 0;
                }
            }
        }

        const mappedStudent = {
            ...student,
            _id: student.id,
            password: undefined,
            groups: student.groups.map(sg => ({
                ...sg,
                groupId: sg.group ? { ...sg.group, _id: sg.group.id } : null,
                group: sg.group ? { ...sg.group, _id: sg.group.id } : null
            })),
            activeMembership: bestMembership
                ? { ...bestMembership, _id: bestMembership.id }
                : null,
            debtAmount,
            isOverdue,
            overdueDays,
            promisedPaymentDate
        };

        res.json({ success: true, student: mappedStudent });
    } catch (error) {
        console.error('Get student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

// POST /api/students
router.post('/', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, gender, email, notes, groupId, password } = req.body;
        if (!name || !lastName || !phone) return res.status(400).json({ success: false, error: 'Имя, фамилия и телефон обязательны' });

        const existing = await prisma.student.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ success: false, error: 'Ученик с таким телефоном уже существует' });

        const pwd = password || Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(pwd, 10);

        const student = await prisma.student.create({
            data: { name, lastName, phone, phoneDigits: phone.replace(/\D/g, ''), gender: gender || null, email: email || null, notes, password: hashedPassword, role: 'student' }
        });

        if (groupId) {
            await prisma.studentGroup.create({ data: { studentId: student.id, groupId, status: 'active' } });
            await prisma.group.update({ where: { id: groupId }, data: { currentStudents: { increment: 1 } } });
        }

        res.status(201).json({ success: true, student: { ...student, _id: student.id, password: undefined }, generatedPassword: password ? undefined : pwd });
    } catch (error) {
        console.error('Create student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания ученика' });
    }
});

// PUT /api/students/:id
router.put('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { name, lastName, phone, gender, email, notes, status, dateOfBirth } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (lastName !== undefined) data.lastName = lastName;
        if (phone !== undefined) { data.phone = phone; data.phoneDigits = phone.replace(/\D/g, ''); }
        if (gender !== undefined) data.gender = gender || null;
        if (email !== undefined) data.email = email || null;
        if (notes !== undefined) data.notes = notes;
        if (status !== undefined) data.status = status;
        if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;

        const student = await prisma.student.update({ where: { id: req.params.id }, data });
        res.json({ success: true, student: { ...student, _id: student.id, password: undefined } });
    } catch (error) {
        console.error('Update student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления' });
    }
});

// DELETE /api/students/:id
router.delete('/:id', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const studentId = req.params.id;
        
        // Fetch to get name
        const student = await prisma.student.findUnique({ where: { id: studentId } });
        if (!student) return res.status(404).json({ success: false, error: 'Ученик не найден' });

        // Удаляем историю посещаемости
        await prisma.classAttendee.deleteMany({ where: { studentId } });
        
        // Удаляем заморозки
        await prisma.freeze.deleteMany({ where: { studentId } });
        
        // Находим все абонементы ученика
        const memberships = await prisma.membership.findMany({ where: { studentId }, select: { id: true } });
        const membershipIds = memberships.map(m => m.id);
        
        // Удаляем историю изменений абонементов (удалено, так как модели нет в Prisma)
        if (membershipIds.length > 0) {
            // Отвязываем абонементы от платежей перед их удалением
            await prisma.payment.updateMany({ 
                where: { membershipId: { in: membershipIds } },
                data: { membershipId: null }
            });
        }
        
        // Снимаем активный абонемент у ученика (циклическая связь)
        await prisma.student.update({ where: { id: studentId }, data: { activeMembershipId: null } });
        
        // Удаляем сами абонементы
        await prisma.membership.deleteMany({ where: { studentId } });
        
        // Удаляем платежи этого ученика
        const payments = await prisma.payment.findMany({ where: { studentId }, select: { id: true } });
        const paymentIds = payments.map(p => p.id);
        
        if (paymentIds.length > 0) {
            // Удаляем связанные кассовые транзакции
            await prisma.cashTransaction.deleteMany({ where: { relatedPaymentId: { in: paymentIds } } });
            
            // Удаляем возможные связи между самими платежами, чтобы избежать конфликтов при удалении
            await prisma.payment.updateMany({ 
                where: { id: { in: paymentIds } }, 
                data: { relatedPaymentId: null } 
            });
            
            await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
        }
        
        // Обнуляем связи в заявках, которые были конвертированы в этого ученика
        await prisma.booking.updateMany({ 
            where: { convertedToStudentId: studentId }, 
            data: { convertedToStudentId: null } 
        });

        // Удаляем связи с группами
        await prisma.studentGroup.deleteMany({ where: { studentId } });
        
        // Наконец, удаляем самого ученика
        await prisma.student.delete({ where: { id: studentId } });
        res.json({ success: true, message: `Ученик "${student.name} ${student.lastName || ''}" удален` });
    } catch (error) {
        console.error('Delete student error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления' });
    }
});

// POST /api/students/:id/add-to-group
router.post('/:id/add-to-group', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { groupId } = req.body;
        if (!groupId) return res.status(400).json({ success: false, error: 'groupId обязателен' });

        const existing = await prisma.studentGroup.findUnique({ where: { studentId_groupId: { studentId: req.params.id, groupId } } });
        if (existing) return res.status(400).json({ success: false, error: 'Ученик уже в этой группе' });

        await prisma.studentGroup.create({ data: { studentId: req.params.id, groupId, status: 'active' } });
        await prisma.group.update({ where: { id: groupId }, data: { currentStudents: { increment: 1 } } });

        res.json({ success: true, message: 'Ученик добавлен в группу' });
    } catch (error) {
        console.error('Add to group error:', error);
        res.status(500).json({ success: false, error: 'Ошибка' });
    }
});

module.exports = router;
